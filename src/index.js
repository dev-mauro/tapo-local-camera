const initServer = require('./server');

try {
    initServer();
} catch (error) {
    console.error("Failed to start application:", error);
    process.exit(1);
}
