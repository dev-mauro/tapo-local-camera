const path = require('path');

const getProjectRoot = () => process.cwd();

const getRecordingsDir = () => path.join(getProjectRoot(), 'grabaciones');

module.exports = { getProjectRoot, getRecordingsDir };
