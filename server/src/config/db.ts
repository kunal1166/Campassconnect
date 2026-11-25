import mongoose from 'mongoose';

let dbConnected = false;
let wasDbConnected = false;

export function isDbConnected(): boolean {
  return dbConnected && mongoose.connection.readyState === 1;
}

export function wasDatabaseConnected(): boolean {
  return wasDbConnected;
}

export async function connectDatabase(): Promise<boolean> {
  mongoose.set('bufferCommands', false);
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.warn('MONGODB_URI not set — running with in-memory store.');
    dbConnected = false;
    return false;
  }
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 3000 });
    dbConnected = true;
    wasDbConnected = true;
    console.log(`MongoDB connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
    return true;
  } catch (error) {
    dbConnected = false;
    console.warn(
      'MongoDB not connected — running with in-memory store:',
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}