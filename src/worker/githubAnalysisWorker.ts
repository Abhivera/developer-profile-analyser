import { Worker } from 'bullmq';
import { GITHUB_ANALYSIS_QUEUE_NAME } from '../queue/githubAnalysisQueue';
import { getRedisConnection } from '../queue/redisConnection';
import { runGithubAnalysisJob } from '../services/githubAnalysisService';

export function createGithubAnalysisWorker(): Worker<{ githubId: string }> {
  const worker = new Worker<{ githubId: string }>(
    GITHUB_ANALYSIS_QUEUE_NAME,
    async (job) => {
      const githubId = job.data?.githubId;
      if (!githubId) {
        throw new Error('Job missing githubId');
      }
      await runGithubAnalysisJob(githubId);
    },
    {
      connection: getRedisConnection(),
      concurrency: Number(process.env.ANALYSIS_WORKER_CONCURRENCY) || 2,
    }
  );

  worker.on('failed', (job, err) => {
    console.error(`Job ${job?.id} failed:`, err);
  });

  return worker;
}
