import mongoose, { Document, Schema } from 'mongoose';

export interface IRepository {
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  url: string;
}

export interface ICrawlSnapshot {
  url: string;
  success: boolean;
  markdownPreview?: string;
  error?: string;
  fetchedAt: Date;
  statusCode?: number;
}

export interface IExternalProfiles {
  linkedin: string[];
  leetcode: string[];
  hackerrank: string[];
  topcoder: string[];
  codeforces: string[];
  atcoder: string[];
  codechef: string[];
  hackerearth: string[];
  codility: string[];
  interviewbit: string[];
}

export interface ILanguageUsage {
  language: string;
  repoCount: number;
}

export interface ITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface IProfileEvaluation {
  totalStars: number;
  totalForks: number;
  totalRepositories: number;
  primaryLanguage: string;
  languageDiversity: number;
  score: number;
  judgmentMessage: string;
  highlights: string[];
  risksOrGaps: string[];
  externalProfiles: IExternalProfiles;
  languageUsageByRepositoryCount: ILanguageUsage[];
  tokenUsage: ITokenUsage;
  model?: string;
}

export interface IUserAnalysis extends Document {
  githubId: string;
  username: string;
  accessToken: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  retryWindowStart?: Date;
  lastRetryAt?: Date;
  repositories: IRepository[];
  evaluation: IProfileEvaluation | null;
  crawlSnapshots: ICrawlSnapshot[];
  createdAt: Date;
  updatedAt: Date;
}

const RepositorySchema = new Schema<IRepository>({
  name: { type: String, required: true },
  description: { type: String },
  language: { type: String },
  stars: { type: Number, default: 0 },
  forks: { type: Number, default: 0 },
  url: { type: String, required: true },
});

const CrawlSnapshotSchema = new Schema<ICrawlSnapshot>(
  {
    url: { type: String, required: true },
    success: { type: Boolean, required: true },
    markdownPreview: { type: String },
    error: { type: String },
    fetchedAt: { type: Date, required: true },
    statusCode: { type: Number },
  },
  { _id: false }
);

const ExternalProfilesSchema = new Schema<IExternalProfiles>(
  {
    linkedin: { type: [String], default: [] },
    leetcode: { type: [String], default: [] },
    hackerrank: { type: [String], default: [] },
    topcoder: { type: [String], default: [] },
    codeforces: { type: [String], default: [] },
    atcoder: { type: [String], default: [] },
    codechef: { type: [String], default: [] },
    hackerearth: { type: [String], default: [] },
    codility: { type: [String], default: [] },
    interviewbit: { type: [String], default: [] },
  },
  { _id: false }
);

const LanguageUsageSchema = new Schema<ILanguageUsage>(
  {
    language: { type: String, required: true },
    repoCount: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const TokenUsageSchema = new Schema<ITokenUsage>(
  {
    promptTokens: { type: Number, default: 0 },
    completionTokens: { type: Number, default: 0 },
    totalTokens: { type: Number, default: 0 },
  },
  { _id: false }
);

const ProfileEvaluationSchema = new Schema<IProfileEvaluation>(
  {
    totalStars: { type: Number, default: 0 },
    totalForks: { type: Number, default: 0 },
    totalRepositories: { type: Number, default: 0 },
    primaryLanguage: { type: String, default: 'Unknown' },
    languageDiversity: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    judgmentMessage: { type: String, default: '' },
    highlights: { type: [String], default: [] },
    risksOrGaps: { type: [String], default: [] },
    externalProfiles: { type: ExternalProfilesSchema, default: () => ({}) },
    languageUsageByRepositoryCount: { type: [LanguageUsageSchema], default: [] },
    tokenUsage: { type: TokenUsageSchema, default: () => ({}) },
    model: { type: String },
  },
  { _id: false }
);

const GithubUserAnalysisSchema = new Schema<IUserAnalysis>(
  {
    githubId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    accessToken: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    retryCount: { type: Number, default: 0 },
    retryWindowStart: { type: Date },
    lastRetryAt: { type: Date },
    repositories: { type: [RepositorySchema], default: [] },
    evaluation: { type: ProfileEvaluationSchema, default: null },
    crawlSnapshots: { type: [CrawlSnapshotSchema], default: [] },
  },
  { timestamps: true }
);

export const GithubUserAnalysis = mongoose.model<IUserAnalysis>(
  'githubUserAnalysis',
  GithubUserAnalysisSchema
);
