// Public surface of the store-page reader, shared by the web app and the
// browser extension (ALL-78). Import it as "@gifts-af/core/store-page".
export { readProductFromHtml, toCents, type PageProduct } from "./read";
export { readAmazonProduct } from "./amazon";
export { MAX_PRICE_CENTS } from "./limits";
export { cleanLink, extractAsin, isAmazonHost, productLink } from "./link";
