import 'dotenv/config';
import mongoose from 'mongoose';
import { createGithubAnalysisWorker } from './worker/githubAnalysisWorker';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/github-analyse';

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log('Worker connected to MongoDB');

  createGithubAnalysisWorker();
  console.log('GitHub analysis worker listening on Redis queue');
}

main().catch((err) => {
  console.error('Worker failed to start', err);
  process.exit(1);
});
