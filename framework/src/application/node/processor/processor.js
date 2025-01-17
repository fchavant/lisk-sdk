/*
 * Copyright © 2019 Lisk Foundation
 *
 * See the LICENSE file at the top-level directory of this distribution
 * for licensing information.
 *
 * Unless otherwise agreed in a custom licensing agreement with the Lisk Foundation,
 * no part of this software, including this file, may be copied, modified,
 * propagated, or distributed except according to the terms contained in the
 * LICENSE file.
 *
 * Removal or modification of this copyright notice is prohibited.
 */

'use strict';

const { cloneDeep } = require('lodash');
const { ForkStatus } = require('@liskhq/lisk-bft');
const { Sequence } = require('../utils/sequence');

const forkStatusList = [
	ForkStatus.IDENTICAL_BLOCK,
	ForkStatus.VALID_BLOCK,
	ForkStatus.DOUBLE_FORGING,
	ForkStatus.TIE_BREAK,
	ForkStatus.DIFFERENT_CHAIN,
	ForkStatus.DISCARD,
];

class Processor {
	constructor({ channel, logger, chainModule }) {
		this.channel = channel;
		this.logger = logger;
		this.chainModule = chainModule;
		this.sequence = new Sequence();
		this.processors = {};
		this.matchers = {};
	}

	// register a block processor with particular version
	register(processor, { matcher } = {}) {
		if (typeof processor.version !== 'number') {
			throw new Error('version property must exist for processor');
		}
		this.processors[processor.version] = processor;
		this.matchers[processor.version] = matcher || (() => true);
	}

	// eslint-disable-next-line no-unused-vars,class-methods-use-this
	async init(genesisBlock) {
		this.logger.debug(
			{ id: genesisBlock.id, payloadHash: genesisBlock.payloadHash },
			'Initializing processor',
		);
		// do init check for block state. We need to load the blockchain
		const blockProcessor = this._getBlockProcessor(genesisBlock);
		await this._processGenesis(genesisBlock, blockProcessor, {
			saveOnlyState: false,
		});
		await this.chainModule.init();
		const stateStore = this.chainModule.newStateStore();
		for (const processor of Object.values(this.processors)) {
			await processor.init.run({ stateStore });
		}
		this.logger.info('Blockchain ready');
	}

	// Serialize a block instance to a JSON format of the block
	async serialize(blockInstance) {
		const blockProcessor = this._getBlockProcessor(blockInstance);
		return blockProcessor.serialize.run({ block: blockInstance });
	}

	// DeSerialize a block instance to a JSON format of the block
	async deserialize(blockJSON) {
		const blockProcessor = this._getBlockProcessor(blockJSON);
		return blockProcessor.deserialize.run({ block: blockJSON });
	}

	// process is for standard processing of block, especially when received from network
	async process(block, { peerId } = {}) {
		return this.sequence.add(async () => {
			this.logger.debug(
				{ id: block.id, height: block.height },
				'Starting to process block',
			);
			const blockProcessor = this._getBlockProcessor(block);
			const { lastBlock } = this.chainModule;

			const forkStatus = await blockProcessor.forkStatus.run({
				block,
				lastBlock,
			});

			if (!forkStatusList.includes(forkStatus)) {
				this.logger.debug(
					{ status: forkStatus, blockId: block.id },
					'Unknown fork status',
				);
				throw new Error('Unknown fork status');
			}

			// Discarding block
			if (forkStatus === ForkStatus.DISCARD) {
				this.logger.debug(
					{ id: block.id, height: block.height },
					'Discarding block',
				);
				return;
			}
			if (forkStatus === ForkStatus.IDENTICAL_BLOCK) {
				this.logger.debug(
					{ id: block.id, height: block.height },
					'Block already processed',
				);
				return;
			}
			if (forkStatus === ForkStatus.DOUBLE_FORGING) {
				this.logger.warn(
					{ id: block.id, generatorPublicKey: block.generatorPublicKey },
					'Discarding block due to double forging',
				);
				return;
			}
			// Discard block and move to different chain
			if (forkStatus === ForkStatus.DIFFERENT_CHAIN) {
				this.logger.debug(
					{ id: block.id, height: block.height },
					'Detected different chain to sync',
				);
				const blockJSON = await this.serialize(block);
				this.channel.publish('app:processor:sync', {
					block: blockJSON,
					peerId,
				});
				return;
			}
			// Replacing a block
			if (forkStatus === ForkStatus.TIE_BREAK) {
				this.logger.info(
					{ id: lastBlock.id, height: lastBlock.height },
					'Received tie breaking block',
				);
				await blockProcessor.validate.run({
					block,
					lastBlock,
				});
				const previousLastBlock = cloneDeep(lastBlock);
				await this._deleteBlock(lastBlock, blockProcessor);
				const newLastBlock = this.chainModule.lastBlock;
				try {
					await this._processValidated(block, newLastBlock, blockProcessor);
				} catch (err) {
					this.logger.error(
						{ id: block.id, previousBlockId: previousLastBlock.id, err },
						'Failed to apply newly received block. restoring previous block.',
					);
					await this._processValidated(
						previousLastBlock,
						newLastBlock,
						blockProcessor,
						{ skipBroadcast: true },
					);
				}
				return;
			}

			this.logger.debug(
				{ id: block.id, height: block.height },
				'Processing valid block',
			);
			await blockProcessor.validate.run({
				block,
				lastBlock,
			});
			await this._processValidated(block, lastBlock, blockProcessor);
		});
	}

	async forkStatus(receivedBlock, lastBlock) {
		const blockProcessor = this._getBlockProcessor(receivedBlock);

		return blockProcessor.forkStatus.run({
			block: receivedBlock,
			lastBlock: lastBlock || this.chainModule.lastBlock,
		});
	}

	async create(values) {
		this.logger.trace({ data: values }, 'Creating block');
		const highestVersion = Math.max.apply(null, Object.keys(this.processors));
		const processor = this.processors[highestVersion];
		return processor.create.run(values);
	}

	// validate checks the block statically
	async validate(block, { lastBlock } = this.chainModule) {
		this.logger.debug(
			{ id: block.id, height: block.height },
			'Validating block',
		);
		const blockProcessor = this._getBlockProcessor(block);
		await blockProcessor.validate.run({
			block,
			lastBlock,
		});
	}

	async validateDetached(block) {
		this.logger.debug(
			{ id: block.id, height: block.height },
			'Validating detached block',
		);
		const blockProcessor = this._getBlockProcessor(block);
		await blockProcessor.validateDetached.run({
			block,
		});
	}

	// processValidated processes a block assuming that statically it's valid
	async processValidated(block, { removeFromTempTable = false } = {}) {
		return this.sequence.add(async () => {
			this.logger.debug(
				{ id: block.id, height: block.height },
				'Processing validated block',
			);
			const { lastBlock } = this.chainModule;
			const blockProcessor = this._getBlockProcessor(block);
			return this._processValidated(block, lastBlock, blockProcessor, {
				skipBroadcast: true,
				removeFromTempTable,
			});
		});
	}

	// apply processes a block assuming that statically it's valid without saving a block
	async apply(block) {
		return this.sequence.add(async () => {
			this.logger.debug(
				{ id: block.id, height: block.height },
				'Applying block',
			);
			const { lastBlock } = this.chainModule;
			const blockProcessor = this._getBlockProcessor(block);
			return this._processValidated(block, lastBlock, blockProcessor, {
				saveOnlyState: true,
				skipBroadcast: true,
			});
		});
	}

	async deleteLastBlock({ saveTempBlock = false } = {}) {
		return this.sequence.add(async () => {
			const { lastBlock } = this.chainModule;
			this.logger.debug(
				{ id: lastBlock.id, height: lastBlock.height },
				'Deleting last block',
			);
			const blockProcessor = this._getBlockProcessor(lastBlock);
			await this._deleteBlock(lastBlock, blockProcessor, saveTempBlock);
			return this.chainModule.lastBlock;
		});
	}

	async applyGenesisBlock(block) {
		this.logger.info({ id: block.id }, 'Applying genesis block');
		const blockProcessor = this._getBlockProcessor(block);
		return this._processGenesis(block, blockProcessor, { saveOnlyState: true });
	}

	async _processValidated(
		block,
		lastBlock,
		processor,
		{ saveOnlyState, skipBroadcast, removeFromTempTable = false } = {},
	) {
		const stateStore = this.chainModule.newStateStore();

		await processor.verify.run({
			block,
			lastBlock,
			skipExistingCheck: saveOnlyState,
			stateStore,
		});

		const blockJSON = await this.serialize(block);
		if (!skipBroadcast) {
			this.channel.publish('app:processor:broadcast', {
				block: blockJSON,
			});
		}

		// Apply should always be executed after save as it performs database calculations
		// i.e. Dpos.apply expects to have this processing block in the database
		await processor.apply.run({
			block,
			lastBlock,
			skipExistingCheck: saveOnlyState,
			stateStore,
		});

		await this.chainModule.save(block, stateStore, {
			saveOnlyState,
			removeFromTempTable,
		});

		return block;
	}

	async _processGenesis(
		block,
		processor,
		{ saveOnlyState } = { saveOnlyState: false },
	) {
		const stateStore = this.chainModule.newStateStore();
		const isPersisted = await this.chainModule.exists(block);
		if (saveOnlyState && !isPersisted) {
			throw new Error('Genesis block is not persisted but skipping to save');
		}
		// If block is persisted and we don't want to save, it means that we are rebuilding. Therefore, don't return without applying block.
		if (isPersisted && !saveOnlyState) {
			return block;
		}
		await processor.applyGenesis.run({
			block,
			stateStore,
		});
		await this.chainModule.save(block, stateStore, { saveOnlyState });

		return block;
	}

	async _deleteBlock(block, processor, saveTempBlock = false) {
		const stateStore = this.chainModule.newStateStore();
		await processor.undo.run({
			block,
			stateStore,
		});
		await this.chainModule.remove(block, stateStore, { saveTempBlock });
	}

	_getBlockProcessor(block) {
		const { version } = block;
		if (!this.processors[version]) {
			throw new Error('Block processing version is not registered');
		}
		// Sort in asc order
		const matcherVersions = Object.keys(this.matchers).sort((a, b) => a - b);
		// eslint-disable-next-line no-restricted-syntax
		for (const matcherVersion of matcherVersions) {
			const matcher = this.matchers[matcherVersion];
			if (matcher(block)) {
				return this.processors[matcherVersion];
			}
		}
		throw new Error('No matching block processor found');
	}
}

module.exports = {
	Processor,
};
