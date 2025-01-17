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

const {
	transfer,
	registerDelegate,
	castVotes,
} = require('@liskhq/lisk-transactions');
const localCommon = require('../common');
const accountFixtures = require('../../../fixtures/accounts');
const { getNetworkIdentifier } = require('../../../utils/network_identifier');

const networkIdentifier = getNetworkIdentifier(
	__testContext.config.genesisBlock,
);

const { NORMALIZER } = global.__testContext.config;

describe('integration test (type 0) - votes collision', () => {
	let library;
	localCommon.beforeBlock('3_votes_collision', lib => {
		library = lib;
	});

	const collisionAccount = {
		address: '13555181540209512417L',
		passphrase:
			'merry field slogan sibling convince gold coffee town fold glad mix page',
		publicKey:
			'ce33db918b059a6e99c402963b42cf51c695068007ef01d8c383bb8a41270263',
		collisionPassphrase:
			'annual youth lift quote off olive uncle town chief poverty extend series',
		collisionPublicKey:
			'b26dd40ba33e4785e49ddc4f106c0493ed00695817235c778f487aea5866400a',
		username: 'xyz',
	};

	const creditTransaction = transfer({
		networkIdentifier,
		amount: (10000 * NORMALIZER).toString(),
		passphrase: accountFixtures.genesis.passphrase,
		recipientId: collisionAccount.address,
	});

	before(done => {
		localCommon.addTransactionsAndForge(
			library,
			[creditTransaction],
			async () => {
				done();
			},
		);
	});

	describe('register delegate from collision account', () => {
		let delegateRegistrationTransaction;
		before(done => {
			delegateRegistrationTransaction = registerDelegate({
				networkIdentifier,
				passphrase: collisionAccount.passphrase,
				username: collisionAccount.username,
			});
			localCommon.addTransactionsAndForge(
				library,
				[delegateRegistrationTransaction],
				async () => {
					done();
				},
			);
		});

		it('transaction should be confirmed', done => {
			const filter = {
				id: delegateRegistrationTransaction.id,
			};

			localCommon.getTransactionFromModule(library, filter, (err, res) => {
				expect(err).to.be.null;
				expect(res)
					.to.have.property('transactions')
					.which.is.an('Array');
				expect(res.transactions.length).to.equal(1);
				expect(res.transactions[0].id).to.equal(
					delegateRegistrationTransaction.id,
				);
				done();
			});
		});

		describe('when voting for account with collision publicKey', () => {
			let voteTransactionWithCollisionPublicKey;
			before(done => {
				voteTransactionWithCollisionPublicKey = castVotes({
					networkIdentifier,
					passphrase: collisionAccount.passphrase,
					votes: [`${collisionAccount.collisionPublicKey}`],
				});

				localCommon.addTransactionsAndForge(
					library,
					[voteTransactionWithCollisionPublicKey],
					async () => {
						done();
					},
				);
			});

			it('transaction should not be confirmed', done => {
				const filter = {
					id: voteTransactionWithCollisionPublicKey.id,
				};

				localCommon.getTransactionFromModule(library, filter, (err, res) => {
					expect(err).to.be.null;
					expect(res)
						.to.have.property('transactions')
						.which.is.an('Array');
					expect(res.transactions.length).to.equal(0);
					done();
				});
			});
		});

		describe('voting for account using registered publicKey', () => {
			let voteTransactionWithActualPublicKey;
			before(done => {
				voteTransactionWithActualPublicKey = castVotes({
					networkIdentifier,
					passphrase: collisionAccount.passphrase,
					votes: [`${collisionAccount.publicKey}`],
				});

				localCommon.addTransactionsAndForge(
					library,
					[voteTransactionWithActualPublicKey],
					async () => {
						done();
					},
				);
			});

			it('transaction should be confirmed', done => {
				const filter = {
					id: voteTransactionWithActualPublicKey.id,
				};

				localCommon.getTransactionFromModule(library, filter, (err, res) => {
					expect(err).to.be.null;
					expect(res)
						.to.have.property('transactions')
						.which.is.an('Array');
					expect(res.transactions.length).to.equal(1);
					expect(res.transactions[0].id).to.equal(
						voteTransactionWithActualPublicKey.id,
					);
					done();
				});
			});
		});
	});
});
