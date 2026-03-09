import mongoose, { Connection } from "mongoose";

let isConnected: boolean = false;

export async function connectMongoDB(): Promise<Connection> {
  if (isConnected) return mongoose.connection;

  const uri = process.env.MONGODB_CONNECTION_SECRET;

  if (!uri) {
    throw new Error(
      "something wrong when connecting to database, please check your db credential set-up",
    );
  }

  try {
    await mongoose.connect(uri);
    isConnected = true;
    console.log("successfully connected to mongoDB");
    return mongoose.connection;
  } catch (error) {
    throw new Error(`something went wrong: ${error}`);
  }
}
