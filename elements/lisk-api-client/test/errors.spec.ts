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
 *
 */
import { APIError, APIErrorData } from '../src/errors';

describe('api errors module', () => {
	let apiError: APIError;
	const defaultMessage = 'this is an error';
	const defaultErrno = 401;

	beforeEach(() => {
		apiError = new APIError();
		return Promise.resolve();
	});

	describe('#constructor', () => {
		it('should create a new instance of APIError', () => {
			return expect(apiError).toBeInstanceOf(APIError);
		});

		it('should set error name to `APIError`', () => {
			return expect(apiError.name).toEqual('APIError');
		});

		it('should set error message to empty string by default', () => {
			return expect(apiError.message).toEqual('');
		});

		it('should set errno to 500 by default', () => {
			return expect(apiError.errno).toEqual(500);
		});

		describe('when passed errno', () => {
			beforeEach(() => {
				apiError = new APIError(defaultMessage, defaultErrno);
				return Promise.resolve();
			});

			it('should set error message when passed through first argument', () => {
				return expect(apiError.message).toEqual(defaultMessage);
			});

			it('should set errno when passed through second argument', () => {
				return expect(apiError.errno).toEqual(defaultErrno);
			});
		});

		describe('when passed errno and errors', () => {
			const errors = [
				{
					code: 'error_code_1',
					message: 'message1',
				},
				{
					code: 'error_code_2',
					message: 'message2',
				},
			];

			beforeEach(() => {
				apiError = new APIError(defaultMessage, defaultErrno, errors);
				return Promise.resolve();
			});

			it('should set error message when passed through first argument', () => {
				return expect(apiError.message).toEqual(defaultMessage);
			});

			it('should set errno when passed through second argument', () => {
				return expect(apiError.errno).toEqual(defaultErrno);
			});

			it('should set errors when passed through third argument', () => {
				expect(apiError.errors).toHaveLength(2);
				const errorData = apiError.errors as ReadonlyArray<APIErrorData>;
				expect(errorData[0].code).toBe(errors[0].code);
				return expect(errorData[0].message).toBe(errors[0].message);
			});
		});
	});
});
