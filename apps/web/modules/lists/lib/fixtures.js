// Demo catalog for the proof of concept.
//
// Amazon blocks automated page fetches (see the note in ./amazon.js), so name and
// price cannot be read for an arbitrary product. These few ASINs are hardcoded so
// the complete auto-fill flow can be demonstrated end to end.
//
// Each image was checked by eye against its ASIN. Prices are representative list
// prices for the demo, not live figures.
export const AMAZON_FIXTURES = {
  B08N5WRWNW: {
    name: 'Apple MacBook Pro 13" (M1, 8GB RAM, 256GB SSD) - Space Gray',
    priceCents: 99900,
  },
  B0BSHF7WHW: {
    name: 'Apple MacBook Pro 16" (M2 Pro, 16GB RAM, 512GB SSD) - Space Gray',
    priceCents: 249900,
  },
  B07FZ8S74R: {
    name: 'Echo Dot (3rd Gen) Smart Speaker with Alexa - Charcoal',
    priceCents: 3999,
  },
  B09B8V1LZ3: {
    name: 'Echo Dot (5th Gen) Smart Speaker with Alexa - Charcoal',
    priceCents: 4999,
  },
  B0863TXGM3: {
    name: 'Sony WH-1000XM4 Wireless Noise Cancelling Headphones - Black',
    priceCents: 34800,
  },
  B01LTHP2ZK: {
    name: 'Nintendo Switch Console with Gray Joy-Con',
    priceCents: 29999,
  },
}
