const placeholders = (text) =>
    [...new Set([...text.matchAll(/\$(\d+)/g)].map(([, n]) => Number(n)))].sort(
        (a, b) => a - b,
    );

const expectedPlaceholders = (values) =>
    Array.from({ length: values.length }, (_, index) => index + 1);

module.exports = { placeholders, expectedPlaceholders };
