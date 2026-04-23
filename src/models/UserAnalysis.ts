import mongoose, { Document, Schema } from 'mongoose';

export interface IRepository {
  name: string;
  description: string;
  language: string;
  stars: number;
  forks: number;
  url: string;
}

export interface IUserAnalysis extends Document {
  githubId: string;
  username: string;
  accessToken: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  repositories: IRepository[];
  evaluation: any; // Can be a structured object or string based on LLM output
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

const UserAnalysisSchema = new Schema<IUserAnalysis>(
  {
    githubId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    accessToken: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed'],
      default: 'pending',
    },
    repositories: { type: [RepositorySchema], default: [] },
    evaluation: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

export const UserAnalysis = mongoose.model<IUserAnalysis>('UserAnalysis', UserAnalysisSchema);
