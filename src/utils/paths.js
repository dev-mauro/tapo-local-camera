const path = require('path');

const getProjectRoot = () => process.cwd();

const getRecordingsDir = () => path.join(getProjectRoot(), 'recordings');

module.exports = { getProjectRoot, getRecordingsDir };
