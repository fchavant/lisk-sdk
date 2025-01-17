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

require('../../../functional');
const Promise = require('bluebird');
const {
	transfer,
	registerSecondPassphrase,
	registerMultisignature,
} = require('@liskhq/lisk-transactions');
const apiHelpers = require('../../../../../utils/http/api');
const randomUtil = require('../../../../../utils/random');
const SwaggerEndpoint = require('../../../../../utils/http/swagger_spec');
const accountFixtures = require('../../../../../fixtures/accounts');
const waitFor = require('../../../../../utils/legacy/wait_for');
const {
	getNetworkIdentifier,
} = require('../../../../../utils/network_identifier');

const networkIdentifier = getNetworkIdentifier(
	__testContext.config.genesisBlock,
);

const { NORMALIZER } = global.__testContext.config;
const expectSwaggerParamError = apiHelpers.expectSwaggerParamError;
const sendTransactionPromise = apiHelpers.sendTransactionPromise;

describe('GET /api/node', () => {
	describe('/transactions', () => {
		describe('/pending', () => {
			const PendingEndpoint = new SwaggerEndpoint(
				'GET /node/transactions/{state}',
			).addParameters({ state: 'pending' });
			const signatureEndpoint = new SwaggerEndpoint('POST /signatures');

			const senderAccount = randomUtil.account();
			const recipientAccount = randomUtil.account();

			const transactionList = [];
			const numOfTransactions = 5;
			let transaction = null;

			const randomMember = randomUtil.account();

			before(() => {
				// Credit account with some funds
				transaction = transfer({
					networkIdentifier,
					amount: (1000 * NORMALIZER).toString(),
					passphrase: accountFixtures.genesis.passphrase,
					recipientId: senderAccount.address,
				});

				return sendTransactionPromise(transaction)
					.then(res => {
						expect(res.body.data.message).to.be.equal(
							'Transaction(s) accepted',
						);

						return waitFor.confirmations([transaction.id]);
					})
					.then(() => {
						// Create Second Signature for sender account
						transaction = registerSecondPassphrase({
							networkIdentifier,
							passphrase: senderAccount.passphrase,
							secondPassphrase: senderAccount.secondPassphrase,
						});

						return sendTransactionPromise(transaction);
					})
					.then(res => {
						expect(res.body.data.message).to.be.equal(
							'Transaction(s) accepted',
						);

						return waitFor.confirmations([transaction.id]);
					})
					.then(() => {
						// Convert account to multisig account
						transaction = registerMultisignature({
							networkIdentifier,
							passphrase: senderAccount.passphrase,
							secondPassphrase: senderAccount.secondPassphrase,
							keysgroup: [`${randomMember.publicKey}`],
							lifetime: 1,
							minimum: 1,
						});

						return sendTransactionPromise(transaction);
					})
					.then(res => {
						expect(res.body.data.message).to.be.equal(
							'Transaction(s) accepted',
						);

						const signature = apiHelpers.createSignatureObject(
							transaction,
							randomMember,
						);

						return signatureEndpoint.makeRequest({ signature }, 200);
					})
					.then(res => {
						expect(res.body.data.message).to.be.equal('Signature Accepted');

						return waitFor.confirmations([transaction.id]);
					})
					.then(() => {
						// Create numOfTransactions transactions
						for (let i = 0; i < numOfTransactions; i++) {
							transactionList.push(
								transfer({
									networkIdentifier,
									amount: ((i + 1) * NORMALIZER).toString(),
									passphrase: senderAccount.passphrase,
									secondPassphrase: senderAccount.secondPassphrase,
									recipientId: recipientAccount.address,
								}),
							);
						}

						return Promise.map(transactionList, mapTransaction => {
							return sendTransactionPromise(mapTransaction);
						});
					})
					.then(responses => {
						responses.map(res => {
							return expect(res.body.data.message).to.be.equal(
								'Transaction(s) accepted',
							);
						});
					});
			});

			describe('with wrong input', () => {
				it('using invalid field name should fail', async () => {
					return PendingEndpoint.makeRequest(
						{
							whatever: accountFixtures.genesis.address,
						},
						400,
					).then(res => {
						expectSwaggerParamError(res, 'whatever');
					});
				});

				it('using empty parameter should fail', async () => {
					return PendingEndpoint.makeRequest(
						{
							recipientPublicKey: '',
						},
						400,
					).then(res => {
						expectSwaggerParamError(res, 'recipientPublicKey');
					});
				});

				it('using completely invalid fields should fail', async () => {
					return PendingEndpoint.makeRequest(
						{
							senderId: 'invalid',
							recipientId: 'invalid',
							limit: 'invalid',
							offset: 'invalid',
							sort: 'invalid',
						},
						400,
					).then(res => {
						expectSwaggerParamError(res, 'senderId');
						expectSwaggerParamError(res, 'recipientId');
						expectSwaggerParamError(res, 'limit');
						expectSwaggerParamError(res, 'offset');
						expectSwaggerParamError(res, 'sort');
					});
				});

				it('using partially invalid fields should fail', async () => {
					return PendingEndpoint.makeRequest(
						{
							senderId: 'invalid',
							recipientId: senderAccount.address,
							limit: 'invalid',
							offset: 'invalid',
							sort: 'invalid',
						},
						400,
					).then(res => {
						expectSwaggerParamError(res, 'senderId');
						expectSwaggerParamError(res, 'limit');
						expectSwaggerParamError(res, 'offset');
						expectSwaggerParamError(res, 'sort');
					});
				});
			});

			it('using no params should be ok', async () => {
				return PendingEndpoint.makeRequest({}, 200).then(res => {
					expect(res.body.meta.count).to.be.at.least(numOfTransactions);
				});
			});

			describe('id', () => {
				it('using invalid id should fail', async () => {
					return PendingEndpoint.makeRequest({ id: '79fjdfd' }, 400).then(
						res => {
							expectSwaggerParamError(res, 'id');
						},
					);
				});

				it('using valid id should be ok', async () => {
					const transactionInCheck = transactionList[0];

					return PendingEndpoint.makeRequest(
						{ id: transactionInCheck.id },
						200,
					).then(res => {
						expect(res.body.data).to.not.empty;
						expect(res.body.data).to.has.length(1);
						expect(res.body.data[0].id).to.be.equal(transactionInCheck.id);
					});
				});

				it('using valid but unknown id should be ok', async () => {
					return PendingEndpoint.makeRequest(
						{ id: '1111111111111111' },
						200,
					).then(res => {
						expect(res.body.data).to.be.empty;
					});
				});
			});

			describe('type', () => {
				it('using invalid type should fail', async () => {
					return PendingEndpoint.makeRequest({ type: 'a' }, 400).then(res => {
						expectSwaggerParamError(res, 'type');
					});
				});

				it('using valid type should be ok', async () => {
					const transactionInCheck = transactionList[0];

					return PendingEndpoint.makeRequest(
						{ type: transactionInCheck.type },
						200,
					).then(res => {
						expect(res.body.data).to.not.empty;
						expect(res.body.data.length).to.be.at.least(numOfTransactions);
						res.body.data.map(mapTransaction => {
							return expect(mapTransaction.type).to.be.equal(
								transactionInCheck.type,
							);
						});
					});
				});
			});

			describe('senderId', () => {
				it('using invalid senderId should fail', async () => {
					return PendingEndpoint.makeRequest({ senderId: '79fjdfd' }, 400).then(
						res => {
							expectSwaggerParamError(res, 'senderId');
						},
					);
				});

				it('using valid senderId should be ok', async () => {
					return PendingEndpoint.makeRequest(
						{ senderId: senderAccount.address },
						200,
					).then(res => {
						expect(res.body.data).to.not.empty;
						expect(res.body.data.length).to.be.at.least(numOfTransactions);
						res.body.data.map(mapTransaction => {
							return expect(mapTransaction.senderId).to.be.equal(
								senderAccount.address,
							);
						});
					});
				});

				it('using valid but unknown senderId should be ok', async () => {
					return PendingEndpoint.makeRequest(
						{ senderId: '1631373961111634666L' },
						200,
					).then(res => {
						expect(res.body.data).to.be.empty;
					});
				});
			});

			describe('senderPublicKey', () => {
				it('using invalid senderPublicKey should fail', async () => {
					return PendingEndpoint.makeRequest(
						{ senderPublicKey: '79fjdfd' },
						400,
					).then(res => {
						expectSwaggerParamError(res, 'senderPublicKey');
					});
				});

				it('using valid senderPublicKey should be ok', async () => {
					return PendingEndpoint.makeRequest(
						{ senderPublicKey: senderAccount.publicKey },
						200,
					).then(res => {
						expect(res.body.data).to.not.empty;
						expect(res.body.data.length).to.be.at.least(numOfTransactions);
						res.body.data.map(mapTransaction => {
							return expect(mapTransaction.senderPublicKey).to.be.equal(
								senderAccount.publicKey,
							);
						});
					});
				});

				it('using valid but unknown senderPublicKey should be ok', async () => {
					return PendingEndpoint.makeRequest(
						{
							senderPublicKey:
								'c094ebee7ec0c50ebeeaaaa8655e089f6e1a604b83bcaa760293c61e0f18ab6f',
						},
						200,
					).then(res => {
						expect(res.body.data).to.be.empty;
					});
				});
			});

			describe('recipientId', () => {
				it('using invalid recipientId should fail', async () => {
					return PendingEndpoint.makeRequest(
						{ recipientId: '79fjdfd' },
						400,
					).then(res => {
						expectSwaggerParamError(res, 'recipientId');
					});
				});

				it('using valid recipientId should be ok', async () => {
					return PendingEndpoint.makeRequest(
						{ recipientId: recipientAccount.address },
						200,
					).then(res => {
						expect(res.body.data).to.not.empty;
						expect(res.body.data.length).to.be.at.least(numOfTransactions);
						res.body.data.map(mapTransaction => {
							return expect(mapTransaction.asset.recipientId).to.be.equal(
								recipientAccount.address,
							);
						});
					});
				});

				it('using valid but unknown recipientId should be ok', async () => {
					return PendingEndpoint.makeRequest(
						{ recipientId: '1631373961111634666L' },
						200,
					).then(res => {
						expect(res.body.data).to.be.empty;
					});
				});
			});

			describe('limit', () => {
				it('using limit < 0 should fail', async () => {
					return PendingEndpoint.makeRequest({ limit: -1 }, 400).then(res => {
						expectSwaggerParamError(res, 'limit');
					});
				});

				it('using limit > 100 should fail', async () => {
					return PendingEndpoint.makeRequest({ limit: 101 }, 400).then(res => {
						expectSwaggerParamError(res, 'limit');
					});
				});

				it('using limit = 2 should return 2 transactions', async () => {
					return PendingEndpoint.makeRequest({ limit: 2 }, 200).then(res => {
						expect(res.body.data).to.not.be.empty;
						expect(res.body.data.length).to.be.at.most(2);
					});
				});
			});

			describe('offset', () => {
				it('using offset="one" should fail', async () => {
					return PendingEndpoint.makeRequest({ offset: 'one' }, 400).then(
						res => {
							expectSwaggerParamError(res, 'offset');
						},
					);
				});

				it('using offset=1 should be ok', async () => {
					let firstTransaction = null;

					return PendingEndpoint.makeRequest({ offset: 0, limit: 2 }, 200)
						.then(res => {
							firstTransaction = res.body.data[0];

							return PendingEndpoint.makeRequest({ offset: 1, limit: 2 }, 200);
						})
						.then(res => {
							res.body.data.forEach(mapTransaction => {
								expect(mapTransaction.id).to.not.equal(firstTransaction.id);
							});
						});
				});
			});

			describe('sort', () => {
				describe('amount', () => {
					it('sorted by amount:asc should be ok', async () => {
						return PendingEndpoint.makeRequest(
							{ sort: 'amount:asc' },
							200,
						).then(res => {
							expect(res.body.data).to.not.be.empty;

							const values = _.map(res.body.data, 'amount').map(value => {
								return parseInt(value, 10);
							});

							expect(_(_.clone(values)).sortNumbers('asc')).to.be.eql(values);
						});
					});

					it('sorted by amount:desc should be ok', async () => {
						return PendingEndpoint.makeRequest(
							{ sort: 'amount:desc' },
							200,
						).then(res => {
							expect(res.body.data).to.not.be.empty;

							const values = _.map(res.body.data, 'amount').map(value => {
								return parseInt(value, 10);
							});

							expect(_(_.clone(values)).sortNumbers('desc')).to.be.eql(values);
						});
					});
				});

				describe('fee', () => {
					it('sorted by fee:asc should be ok', async () => {
						return PendingEndpoint.makeRequest({ sort: 'fee:asc' }, 200).then(
							res => {
								expect(res.body.data).to.not.be.empty;

								const values = _.map(res.body.data, 'fee').map(value => {
									return parseInt(value, 10);
								});

								expect(_(_.clone(values)).sortNumbers('asc')).to.be.eql(values);
							},
						);
					});

					it('sorted by fee:desc should be ok', async () => {
						return PendingEndpoint.makeRequest({ sort: 'fee:desc' }, 200).then(
							res => {
								expect(res.body.data).to.not.be.empty;

								const values = _.map(res.body.data, 'fee').map(value => {
									return parseInt(value, 10);
								});

								expect(_(_.clone(values)).sortNumbers('desc')).to.be.eql(
									values,
								);
							},
						);
					});
				});

				describe('type', () => {
					it('sorted by fee:asc should be ok', async () => {
						return PendingEndpoint.makeRequest({ sort: 'type:asc' }, 200).then(
							res => {
								expect(res.body.data).to.not.be.empty;

								expect(
									_(res.body.data)
										.map('type')
										.sortNumbers('asc'),
								).to.be.eql(_.map(res.body.data, 'type'));
							},
						);
					});

					it('sorted by fee:desc should be ok', async () => {
						return PendingEndpoint.makeRequest({ sort: 'type:desc' }, 200).then(
							res => {
								expect(res.body.data).to.not.be.empty;

								expect(
									_(res.body.data)
										.map('type')
										.sortNumbers('desc'),
								).to.be.eql(_.map(res.body.data, 'type'));
							},
						);
					});
				});

				describe('timestamp', () => {
					it('sorted by timestamp:asc should be ok', async () => {
						return PendingEndpoint.makeRequest(
							{ sort: 'timestamp:asc' },
							200,
						).then(res => {
							expect(res.body.data).to.not.be.empty;

							expect(
								_(res.body.data)
									.map('timestamp')
									.sortNumbers('asc'),
							).to.be.eql(_.map(res.body.data, 'timestamp'));
						});
					});

					it('sorted by timestamp:desc should be ok', async () => {
						return PendingEndpoint.makeRequest(
							{ sort: 'timestamp:desc' },
							200,
						).then(res => {
							expect(res.body.data).to.not.be.empty;

							expect(
								_(res.body.data)
									.map('timestamp')
									.sortNumbers('desc'),
							).to.be.eql(_.map(res.body.data, 'timestamp'));
						});
					});
				});

				it('using any other sort field should fail', async () => {
					return PendingEndpoint.makeRequest({ sort: 'id:asc' }, 400).then(
						res => {
							expectSwaggerParamError(res, 'sort');
						},
					);
				});
			});
		});
	});
});
