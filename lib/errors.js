class InvalidRequestError extends Error {
    constructor(message) {
        super(message);
        this.name = "InvalidRequestError";
        this.statusCode = 400;
    }
}

// Its message is sent to the caller; the cause is only logged.
class ServiceError extends Error {
    constructor(message, cause) {
        super(message, { cause });
        this.name = "ServiceError";
        this.statusCode = 500;
    }
}

module.exports = { InvalidRequestError, ServiceError };
