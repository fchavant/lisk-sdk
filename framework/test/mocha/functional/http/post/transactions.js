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

require('../../functional');
const { transfer } = require('@liskhq/lisk-transactions');
const SwaggerSpec = require('../../../../utils/http/swagger_spec');
const randomUtil = require('../../../../utils/random');
const accountFixtures = require('../../../../fixtures/accounts');
const sendTransactionPromise = require('../../../../utils/http/api')
	.sendTransactionPromise;
const apiCodes = require('../../../../../src/modules/http_api/api_codes');
const phases = require('../../../../utils/legacy/transaction_confirmation');
const {
	getNetworkIdentifier,
} = require('../../../../utils/network_identifier');

const networkIdentifier = getNetworkIdentifier(
	__testContext.config.genesisBlock,
);

describe('POST /api/transactions (general)', () => {
	const transactionsEndpoint = new SwaggerSpec('POST /transactions');
	const account = randomUtil.account();
	const transaction = transfer({
		networkIdentifier,
		amount: '1',
		passphrase: accountFixtures.genesis.passphrase,
		recipientId: account.address,
		timeOffset: -10000,
	});

	it('should fail if null transaction posted', async () => {
		return transactionsEndpoint
			.makeRequest({ transaction: null }, 400)
			.then(res => {
				expect(res.body.message).to.eql('Parse errors');
				expect(res.body.errors[0].code).to.be.equal('INVALID_REQUEST_PAYLOAD');
			});
	});

	it('should fail on more than one transactions at a time', async () => {
		return transactionsEndpoint
			.makeRequest(
				{ transactions: [randomUtil.transaction(), randomUtil.transaction()] },
				400,
			)
			.then(res => {
				expect(res.body.message).to.eql('Validation errors');
				expect(res.body.errors[0].code).to.be.equal(
					'INVALID_REQUEST_PARAMETER',
				);
			});
	});

	describe('transaction processing', () => {
		sendTransactionPromise(transaction).then(res => {
			expect(res.body.data.message).to.be.equal('Transaction(s) accepted');
		});
		return phases.confirmation([transaction], []);
	});

	describe('verification', () => {
		it('should fail when trying to send a transaction that is already confirmed', async () => {
			return sendTransactionPromise(
				transaction,
				apiCodes.PROCESSING_ERROR,
			).then(res => {
				expect(res.body.message).to.be.eql(
					'Transaction was rejected with errors',
				);
				expect(res.body.code).to.be.eql(apiCodes.PROCESSING_ERROR);
				expect(res.body.errors[0].message).to.be.equal(
					`Transaction is already confirmed: ${transaction.id}`,
				);
			});
		});
	});
});
