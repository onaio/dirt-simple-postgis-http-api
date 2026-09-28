class InvalidRequestError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidRequestError";
        this.statusCode = 400;
    }
}

module.exports = { InvalidRequestError };
