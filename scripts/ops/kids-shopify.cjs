// Operations are validated against the store's 2026-07 Admin schema before deployment.
module.exports = {
    list: `query Kids($after: String) { products(first: 25, after: $after, query: "tag:kids-kits") { pageInfo { hasNextPage endCursor } nodes { id title handle status descriptionHtml tags options { name position } variants(first: 10) { nodes { id title sku price compareAtPrice inventoryPolicy selectedOptions { name value } inventoryItem { tracked requiresShipping } } } media(first: 10) { nodes { id alt mediaContentType ... on MediaImage { image { url } } } } } } }`,
    stage: `mutation KidsImages($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
    update: `mutation MigrateKids($identifier: ProductSetIdentifiers!, $input: ProductSetInput!) { productSet(identifier: $identifier, input: $input, synchronous: true) { product { id handle status variants(first: 10) { nodes { id sku price selectedOptions { name value } } } media(first: 10) { nodes { id alt } } } userErrors { field message } } }`,
    media: `query KidsMedia($id: ID!) { product(id: $id) { id handle status media(first: 10) { nodes { id alt ... on MediaImage { image { url } } } } variants(first: 10) { nodes { id sku price selectedOptions { name value } } } } }`,
    reorder: `mutation KidsImageOrder($id: ID!, $moves: [MoveInput!]!) { productReorderMedia(id: $id, moves: $moves) { job { id } mediaUserErrors { field message } } }`,
};
