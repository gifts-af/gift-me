import { describe, expect, it } from 'vitest'
import { lookupProductLink } from '../amazon.js'

describe('lookupProductLink: links from stores other than Amazon (ALL-10)', () => {
  it('takes the name from a Walmart link and asks for the price', async () => {
    const result = await lookupProductLink(
      'https://www.walmart.com/ip/Great-Value-Long-Grain-Enriched-Rice-32-oz/10315394',
    )
    expect(result.status).toBe('partial')
    expect(result.missing).toEqual(['priceCents'])
    expect(result.product).toEqual({
      name: 'Great Value Long Grain Enriched Rice 32 Oz',
      priceCents: null,
      imageUrl: null,
      productUrl: 'https://www.walmart.com/ip/Great-Value-Long-Grain-Enriched-Rice-32-oz/10315394',
      asin: null,
      source: 'store-url',
      store: 'walmart.com',
    })
  })

  it('reads the name from Target and Best Buy links', async () => {
    const target = await lookupProductLink(
      'https://www.target.com/p/stanley-40oz-quencher-tumbler/-/A-87654321',
    )
    expect(target.product.name).toBe('Stanley 40oz Quencher Tumbler')

    const bestBuy = await lookupProductLink(
      'https://www.bestbuy.com/site/sony-wh-1000xm5-wireless-headphones/6505727.p?skuId=6505727',
    )
    expect(bestBuy.product.name).toBe('Sony Wh 1000xm5 Wireless Headphones')
    expect(bestBuy.product.store).toBe('bestbuy.com')
  })

  it('asks for the name too when the link has only an ID', async () => {
    const result = await lookupProductLink('https://www.walmart.com/ip/10315394')
    expect(result.product.name).toBeNull()
    expect(result.missing).toEqual(['name', 'priceCents'])
  })

  it('keeps the link but drops tracking tags and the #fragment', async () => {
    const result = await lookupProductLink(
      'walmart.com/ip/Lipton-Tea/123?selected=true&utm_source=email&gclid=abc#reviews',
    )
    expect(result.product.productUrl).toBe('https://walmart.com/ip/Lipton-Tea/123?selected=true')
  })

  it('refuses links that are not web pages', async () => {
    expect((await lookupProductLink('ftp://files.example.com/x')).error.code).toBe('INVALID_URL')
    expect((await lookupProductLink('localhost/thing')).error.code).toBe('INVALID_URL')
    expect((await lookupProductLink('not a link')).error.code).toBe('INVALID_URL')
  })

  it('still handles Amazon links and their errors as before', async () => {
    const amazon = await lookupProductLink('https://www.amazon.com/Wool-Hiking-Socks/dp/B0EXAMPLE1')
    expect(amazon.product.source).toBe('amazon-url')
    expect(amazon.product.asin).toBe('B0EXAMPLE1')
    expect((await lookupProductLink('https://amzn.to/abc')).error.code).toBe('SHORT_LINK')
    expect((await lookupProductLink('https://www.amazon.com/gp/help')).error.code).toBe('NO_ASIN')
    expect((await lookupProductLink('   ')).error.code).toBe('EMPTY_INPUT')
  })
})

describe('storeName', () => {
  it('says Amazon for any Amazon site and the bare domain for other stores', async () => {
    const { storeName } = await import('../amazon.js')
    expect(storeName('https://www.amazon.co.uk/dp/B0EXAMPLE1')).toBe('Amazon')
    expect(storeName('https://www.walmart.com/ip/x/1')).toBe('walmart.com')
    expect(storeName('https://shop.example.co/p/1')).toBe('shop.example.co')
    expect(storeName('not a url')).toBeNull()
  })
})
