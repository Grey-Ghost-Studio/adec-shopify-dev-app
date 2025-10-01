import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock axios before importing the handler
vi.mock('axios', () => ({
	default: {
		get: vi.fn(),
		post: vi.fn(),
		put: vi.fn(),
	},
}))

// Mock crypto
vi.mock('crypto', () => ({
	default: {
		createHmac: vi.fn(() => ({
			update: vi.fn().mockReturnThis(),
			digest: vi.fn(() => 'test-signature'),
		})),
	},
}))

// Mock environment variables - include secret so signature verification works
const originalEnv = process.env
vi.stubGlobal('process', {
	env: {
		...originalEnv,
		SHOP_DOMAIN: 'test-shop.myshopify.com',
		SHOPIFY_ACCESS_TOKEN: 'test-token',
		SHOPIFY_API_VERSION: '2025-01',
		SHOPIFY_API_SECRET: 'test-secret', // so verification can work with mocked crypto
	},
})

// Import the actual handler after mocking
const axios = await import('axios')
const { handler } = await import('../netlify/functions/create-draft-order.js')

const mockedAxios = vi.mocked(axios.default)

describe('create-draft-order.js - Real Logic Tests', () => {
	let baseEvent

	beforeEach(() => {
		vi.clearAllMocks()

		// Base event with minimal required params
		baseEvent = {
			httpMethod: 'POST',
			queryStringParameters: {
				signature: 'test-signature',
				timestamp: '1609459200',
			},
			body: JSON.stringify({
				draft_order: {
					line_items: [
						{
							variant_id: 12345,
							title: 'Test Product',
							price: '99.99',
							quantity: 1,
						},
					],
					customer: {
						email: 'test@example.com',
						first_name: 'Test',
						last_name: 'Customer',
					},
					note: 'Practice Name: Test Practice\nZIP/Postal Code: 12345\nCountry: Canada\nRole: Dentist',
				},
				language: 'en',
			}),
		}
	})

	describe('HTTP Method Validation', () => {
		it('should return 405 for GET requests', async () => {
			const getEvent = { ...baseEvent, httpMethod: 'GET' }

			const result = await handler(getEvent, {})

			expect(result.statusCode).toBe(405)
			const body = JSON.parse(result.body)
			expect(body.error).toBe('Method not allowed')
		})

		it('should return 204 for OPTIONS requests (CORS)', async () => {
			const optionsEvent = { ...baseEvent, httpMethod: 'OPTIONS' }

			const result = await handler(optionsEvent, {})

			expect(result.statusCode).toBe(204)
			expect(result.headers).toEqual({
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Headers': 'Content-Type',
				'Access-Control-Allow-Methods': 'POST, OPTIONS',
			})
		})
	})

	describe('Request Validation', () => {
		it('should return 400 for missing draft order data', async () => {
			const invalidEvent = {
				...baseEvent,
				body: JSON.stringify({
					language: 'en',
					// No draft_order field
				}),
			}

			const result = await handler(invalidEvent, {})

			expect(result.statusCode).toBe(400)
			const body = JSON.parse(result.body)
			expect(body.error).toBe('Missing draft order data')
		})

		it('should return 400 for missing required query parameters', async () => {
			const invalidEvent = {
				...baseEvent,
				queryStringParameters: {}, // No signature or timestamp
			}

			const result = await handler(invalidEvent, {})

			expect(result.statusCode).toBe(400)
			const body = JSON.parse(result.body)
			expect(body.error).toBe('Missing required query parameters')
		})
	})

	describe('Product Reservation Logic', () => {
		it('should return 200 for successful reservation when product is available', async () => {
			// Mock successful API responses
			mockedAxios.get.mockImplementation((url) => {
				if (url.includes('/variants/12345')) {
					return Promise.resolve({
						data: { variant: { product_id: 67890, id: 12345 } },
					})
				}
				if (url.includes('/products/67890.json')) {
					return Promise.resolve({
						data: { product: { id: 67890, title: 'Test Product' } },
					})
				}
				if (url.includes('/metafields.json')) {
					// Mock metafields response - product has "Available" status
					return Promise.resolve({
						data: {
							metafields: [
								{
									namespace: 'custom',
									key: 'availability_status',
									value: 'In stock',
								},
							],
						},
					})
				}
				return Promise.resolve({ data: {} })
			})

			mockedAxios.post.mockImplementation((url) => {
				if (url.includes('draft_orders.json')) {
					return Promise.resolve({
						data: { draft_order: { id: 123456, name: '#D1001' } },
					})
				}
				return Promise.resolve({ data: {} })
			})

			mockedAxios.put.mockResolvedValue({ data: {} })

			const result = await handler(baseEvent, {})

			expect(result.statusCode).toBe(200)
			const body = JSON.parse(result.body)
			expect(body.success).toBe(true)
			expect(body.reservation_number).toMatch(/^RES-\d{6}-\d{4}$/)
			expect(body.product_id).toBe(67890)
			expect(body.draft_order.id).toBe(123456)
		})

		it('should return 409 when product is already reserved - REAL CONFLICT DETECTION', async () => {
			// Mock API responses showing product IS reserved
			mockedAxios.get.mockImplementation((url) => {
				if (url.includes('/variants/12345')) {
					return Promise.resolve({
						data: { variant: { product_id: 67890, id: 12345 } },
					})
				}
				if (url.includes('/products/67890.json')) {
					return Promise.resolve({
						data: { product: { id: 67890, title: 'Test Product' } },
					})
				}
				if (url.includes('/metafields.json')) {
					// Mock metafields response - product has "Reserved" status
					return Promise.resolve({
						data: {
							metafields: [
								{
									namespace: 'custom',
									key: 'availability_status',
									value: 'Reserved',
								},
							],
						},
					})
				}
				return Promise.resolve({ data: {} })
			})

			const result = await handler(baseEvent, {})

			expect(result.statusCode).toBe(409)
			const body = JSON.parse(result.body)
			expect(body.success).toBe(false)
			expect(body.error).toBe('Product is already reserved')
			expect(body.error_type).toBe('PRODUCT_ALREADY_RESERVED')
			expect(body.product_id).toBe(67890)
		})

		it('should return 200 when product has no availability_status metafield (not reserved)', async () => {
			// Mock API responses showing product has no availability_status metafield
			mockedAxios.get.mockImplementation((url) => {
				if (url.includes('/variants/12345')) {
					return Promise.resolve({
						data: { variant: { product_id: 67890, id: 12345 } },
					})
				}
				if (url.includes('/products/67890.json')) {
					return Promise.resolve({
						data: { product: { id: 67890, title: 'Test Product' } },
					})
				}
				if (url.includes('/metafields.json')) {
					// Mock metafields response - no availability_status metafield
					return Promise.resolve({
						data: {
							metafields: [
								{
									namespace: 'custom',
									key: 'some_other_field',
									value: 'some_value',
								},
							],
						},
					})
				}
				return Promise.resolve({ data: {} })
			})

			mockedAxios.post.mockImplementation((url) => {
				if (url.includes('draft_orders.json')) {
					return Promise.resolve({
						data: { draft_order: { id: 123456, name: '#D1001' } },
					})
				}
				return Promise.resolve({ data: {} })
			})

			mockedAxios.put.mockResolvedValue({ data: {} })

			const result = await handler(baseEvent, {})

			expect(result.statusCode).toBe(200)
			const body = JSON.parse(result.body)
			expect(body.success).toBe(true)
			expect(body.reservation_number).toMatch(/^RES-\d{6}-\d{4}$/)
			expect(body.product_id).toBe(67890)
			expect(body.draft_order.id).toBe(123456)
		})

		it('should handle Shopify API errors gracefully and continue processing', async () => {
			// Mock API failure for variant lookup but success for draft order creation
			mockedAxios.get.mockRejectedValue(new Error('Shopify API Error'))
			mockedAxios.post.mockResolvedValue({
				data: { draft_order: { id: 123456, name: '#D1001' } },
			})
			mockedAxios.put.mockResolvedValue({ data: {} })

			const result = await handler(baseEvent, {})

			// The function gracefully handles the error and continues with draft order creation
			expect(result.statusCode).toBe(200)
			const body = JSON.parse(result.body)
			expect(body.success).toBe(true)
			expect(body.reservation_number).toMatch(/^RES-\d{6}-\d{4}$/)
		})
	})

	describe('API Call Verification', () => {
		it('should make the correct API calls in sequence', async () => {
			// Setup mocks
			mockedAxios.get.mockImplementation((url) => {
				if (url.includes('/variants/12345')) {
					return Promise.resolve({
						data: { variant: { product_id: 67890, id: 12345 } },
					})
				}
				if (url.includes('/products/67890.json')) {
					return Promise.resolve({
						data: { product: { id: 67890, title: 'Test Product' } },
					})
				}
				if (url.includes('/metafields.json')) {
					return Promise.resolve({
						data: { metafields: [] },
					})
				}
				return Promise.resolve({ data: {} })
			})

			mockedAxios.post.mockResolvedValue({
				data: { draft_order: { id: 123456, name: '#D1001' } },
			})
			mockedAxios.put.mockResolvedValue({ data: {} })

			await handler(baseEvent, {})

			// Verify the correct sequence of API calls
			const getCalls = mockedAxios.get.mock.calls
			expect(getCalls.some((call) => call[0].includes('/variants/12345'))).toBe(
				true
			)
			expect(
				getCalls.some((call) => call[0].includes('/products/67890.json'))
			).toBe(true)
			expect(
				getCalls.some((call) => call[0].includes('/metafields.json'))
			).toBe(true)

			// Should call draft order creation
			expect(mockedAxios.post).toHaveBeenCalledWith(
				expect.stringContaining('draft_orders.json'),
				expect.any(Object),
				expect.any(Object)
			)
		})
	})
})
