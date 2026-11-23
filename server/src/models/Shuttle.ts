import mongoose, { Schema } from 'mongoose';

const shuttleSchema = new Schema({
  code: { type: String, required: true, unique: true },
  routeName: { type: String, required: true },
  origin: { type: String, required: true },
  destination: { type: String, required: true },
  stops: { type: [String], default: [] },
  latitude: Number,
  longitude: Number,
  heading: Number,
  speedKmph: Number,
  lastGpsAt: Date,
  active: { type: Boolean, default: true },
  driver: { type: Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

export const Shuttle = mongoose.model('Shuttle', shuttleSchema);