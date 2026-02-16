const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const { saveAuthKey, getAuthKey, deleteAuthKey } = require('../db/database');
const logger = require('../utils/logger');

const usePostgresAuthState = async (sessionId) => {
    // Helper to read data from DB
    const readData = async (category, id) => {
        try {
            const data = await getAuthKey(category, id);
            if (!data) return null;
            return JSON.parse(data, BufferJSON.reviver);
        } catch (error) {
            logger.error(`Error reading auth data (${category}, ${id}):`, error);
            return null;
        }
    };

    // Helper to write data to DB
    const writeData = async (category, id, value) => {
        try {
            const data = JSON.stringify(value, BufferJSON.replacer);
            await saveAuthKey(category, id, data);
        } catch (error) {
            logger.error(`Error writing auth data (${category}, ${id}):`, error);
        }
    };

    // Helper to delete data from DB
    const deleteData = async (category, id) => {
        try {
            await deleteAuthKey(category, id);
        } catch (error) {
            logger.error(`Error deleting auth data (${category}, ${id}):`, error);
        }
    };

    // Load credentials (creds.json)
    const creds = (await readData('creds', 'env')) || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(
                        ids.map(async (id) => {
                            let value = await readData(type, id);
                            if (type === 'app-state-sync-key' && value) {
                                value = proto.Message.AppStateSyncKeyData.fromObject(value);
                            }
                            data[id] = value;
                        })
                    );
                    return data;
                },
                set: async (data) => {
                    const tasks = [];
                    for (const type in data) {
                        for (const id in data[type]) {
                            const value = data[type][id];
                            if (value) {
                                tasks.push(writeData(type, id, value));
                            } else {
                                tasks.push(deleteData(type, id));
                            }
                        }
                    }
                    await Promise.all(tasks);
                },
            },
        },
        saveCreds: async () => {
            await writeData('creds', 'env', creds);
        },
    };
};

module.exports = { usePostgresAuthState };
