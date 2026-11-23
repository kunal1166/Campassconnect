import mongoose, { Schema } from 'mongoose';

const itemSchema = new Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  category: { type: String, default: 'Personal items' },
  location: { type: String, required: true },
  status: { type: String, enum: ['Lost', 'Found', 'Claimed', 'Resolved'], required: true },
  imageUrl: { type: String, default: '' },
  imageEmbedding: { type: [Number], default: undefined },
  reportedAt: { type: Date, default: Date.now },
  owner: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  contact: { type: String, default: '' },
  isDemo: { type: Boolean, default: false }
}, { timestamps: true });

itemSchema.index({ title: 'text', description: 'text', category: 'text', location: 'text' });
export const Item = mongoose.model('Item', itemSchema);