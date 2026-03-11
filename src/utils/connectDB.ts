import mongoose from 'mongoose';

export const MONGODB_CONNECTED = 1 as const;
export const MONGODB_DISCONNECTED = 0 as const;

export const connectDB = async (): Promise<void> => {
  try {
    const mongoURI = process.env.MONGO_URI;

    if (!mongoURI) {
      console.error('❌ MONGO_URI is not defined in environment variables');
      console.error('⚠️  Bot will continue running but database features will not work.');
      return;
    }

    if (mongoose.connection.readyState === MONGODB_CONNECTED) {
      console.log('✓ MongoDB already connected');
      return;
    }

    let normalizedURI = mongoURI;
    if (normalizedURI.includes('localhost')) {
      normalizedURI = normalizedURI.replace('localhost', '127.0.0.1');
      console.log('[MongoDB] Normalized connection string (localhost -> 127.0.0.1)');
    }

    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000,
      bufferCommands: false,
      retryWrites: true,
    };

    mongoose.connection.on('error', (error) => {
      console.error('❌ MongoDB connection error:', error);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected');
      setTimeout(() => {
        if (mongoose.connection.readyState === MONGODB_DISCONNECTED) {
          console.log('[MongoDB] Attempting to reconnect...');
          connectDB().catch((error) => {
            console.error('[MongoDB] Reconnection failed:', error);
          });
        }
      }, 5000);
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✓ MongoDB reconnected');
    });

    console.log(`[MongoDB] Attempting to connect...`);

    let retries = 3;
    let lastError: Error | null = null;

    while (retries > 0) {
      try {
        await mongoose.connect(normalizedURI, options);
        console.log('✓ MongoDB connected successfully');

        process.on('SIGINT', async () => {
          await mongoose.connection.close();
          console.log('MongoDB connection closed through app termination');
          process.exit(0);
        });

        return;
      } catch (connectError) {
        lastError = connectError instanceof Error ? connectError : new Error(String(connectError));
        retries--;
        if (retries > 0) {
          console.warn(`[MongoDB] Connection attempt failed, retrying... (${retries} attempts left)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }

    throw lastError || new Error('Failed to connect to MongoDB after retries');
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
    if (error instanceof Error && (error.message.includes('ECONNREFUSED') || error.message.includes('closed'))) {
      console.error('⚠️  MongoDB is not running or not accessible!');
      console.error('⚠️  Bot will continue running but database features will not work.');
    }
    mongoose.set('bufferCommands', false);
  }
};

export const isDBConnected = (): boolean => {
  return mongoose.connection.readyState === MONGODB_CONNECTED;
};
