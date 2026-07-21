
const { getChatModelProfile, warmupChatModelCatalogs } = require('./src/server/aiProxy/catalogStore.ts');

async function test() {
  await warmupChatModelCatalogs();
  const profile = getChatModelProfile('deepseek-chat'); // assume this is a model ID
  console.log('Profile:', profile);
}

test();
