import mongoose, { Schema } from 'mongoose';

const notificationSchema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['match', 'bus', 'alert', 'system'], default: 'system' },
  read: { type: Boolean, default: false },
  relatedItem: { type: Schema.Types.ObjectId, ref: 'Item', default: null }
}, { timestamps: true });

export const Notification = mongoose.model('Notification', notificationSchema);