import { MongoClient } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

const getClientPromise = () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("缺少 MONGODB_URI 环境变量。");
  }
  if (!global.__mongoClientPromise) {
    global.__mongoClientPromise = new MongoClient(uri, {
      maxPoolSize: 10,
    })
      .connect()
      .catch((error) => {
        global.__mongoClientPromise = undefined;
        throw error;
      });
  }
  return global.__mongoClientPromise;
};

const getHealthyClient = async (isRetry = false): Promise<MongoClient> => {
  const client = await getClientPromise();

  try {
    await client.db().command({ ping: 1 });
    return client;
  } catch (error) {
    if (isRetry) {
      throw error;
    }

    global.__mongoClientPromise = undefined;
    return getHealthyClient(true);
  }
};

export async function getMongoDb() {
  const client = await getHealthyClient();
  return client.db();
}
