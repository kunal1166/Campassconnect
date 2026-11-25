import crypto from 'node:crypto';
import { isDbConnected } from './db.js';
import { User } from '../models/User.js';
import { Item } from '../models/Item.js';
import { Notification } from '../models/Notification.js';
import { Shuttle } from '../models/Shuttle.js';

export interface StoredUser {
  _id: string;
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: 'student' | 'driver' | 'admin';
  createdAt: Date;
}

export interface StoredItem {
  _id: string;
  id: string;
  title: string;
  description: string;
  category: string;
  location: string;
  status: 'Lost' | 'Found' | 'Claimed' | 'Resolved';
  imageUrl: string;
  imageEmbedding?: number[];
  reportedAt: Date;
  owner: string | null;
  contact: string;
  isDemo: boolean;
  createdAt: Date;
}

export interface StoredNotification {
  _id: string;
  id: string;
  user: string | null;
  title: string;
  message: string;
  type: 'match' | 'bus' | 'alert' | 'system';
  read: boolean;
  relatedItem: string | null;
  createdAt: Date;
}

export interface StoredShuttle {
  _id: string;
  id: string;
  code: string;
  routeName: string;
  origin: string;
  destination: string;
  stops: string[];
  latitude?: number;
  longitude?: number;
  heading?: number;
  speedKmph?: number;
  lastGpsAt?: Date;
  active: boolean;
  driver?: string | null;
}

export interface InsightsSummary {
  totalReports: number;
  itemsRecovered: number;
  lostReports: number;
  foundReports: number;
  recoveryRate: number;
}

export interface MonthlyInsightTrend {
  key: string;
  label: string;
  total: number;
  lost: number;
  found: number;
  recovered: number;
}

export interface LocationInsightStat {
  location: string;
  total: number;
  lost: number;
  found: number;
  recovered: number;
}

export interface InsightsData {
  summary: InsightsSummary;
  monthlyTrends: MonthlyInsightTrend[];
  locationStats: LocationInsightStat[];
  hasShuttleTripData: boolean;
  generatedAt: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatMonthLabel(key: string): string {
  const [yearStr, monthStr] = key.split('-');
  const monthIdx = Number(monthStr) - 1;
  if (!yearStr || !Number.isInteger(monthIdx) || monthIdx < 0 || monthIdx > 11) {
    return key;
  }
  return `${MONTH_NAMES[monthIdx]} ${yearStr}`;
}

const memUsers: StoredUser[] = [];
const memItems: StoredItem[] = [];
const memNotifications: StoredNotification[] = [];
const memShuttles: StoredShuttle[] = [];

function newId(): string {
  return crypto.randomBytes(12).toString('hex');
}

function toStoredItem(doc: any): StoredItem {
  const id = String(doc._id ?? doc.id);
  return {
    _id: id,
    id,
    title: doc.title,
    description: doc.description || '',
    category: doc.category || 'Personal items',
    location: doc.location,
    status: doc.status,
    imageUrl: doc.imageUrl || '',
    imageEmbedding: doc.imageEmbedding,
    reportedAt: doc.reportedAt ? new Date(doc.reportedAt) : new Date(),
    owner: doc.owner ? String(doc.owner) : null,
    contact: doc.contact || '',
    isDemo: Boolean(doc.isDemo),
    createdAt: doc.createdAt ? new Date(doc.createdAt) : new Date(),
  };
}

export const store = {
  // Users
  async findUserByEmail(email: string): Promise<StoredUser | null> {
    if (isDbConnected()) {
      const doc = await User.findOne({ email });
      if (!doc) return null;
      return {
        _id: String(doc._id),
        id: String(doc._id),
        name: doc.name,
        email: doc.email,
        passwordHash: doc.passwordHash,
        role: doc.role as StoredUser['role'],
        createdAt: doc.createdAt,
      };
    }
    return memUsers.find(u => u.email === email) ?? null;
  },

  async findUserById(id: string): Promise<StoredUser | null> {
    if (isDbConnected()) {
      const doc = await User.findById(id);
      if (!doc) return null;
      return {
        _id: String(doc._id),
        id: String(doc._id),
        name: doc.name,
        email: doc.email,
        passwordHash: doc.passwordHash,
        role: doc.role as StoredUser['role'],
        createdAt: doc.createdAt,
      };
    }
    return memUsers.find(u => u._id === id) ?? null;
  },

  async createUser(input: { name: string; email: string; passwordHash: string; role: 'student' | 'driver' | 'admin' }): Promise<StoredUser> {
    if (isDbConnected()) {
      const doc = await User.create(input);
      return {
        _id: String(doc._id),
        id: String(doc._id),
        name: doc.name,
        email: doc.email,
        passwordHash: doc.passwordHash,
        role: doc.role as StoredUser['role'],
        createdAt: doc.createdAt,
      };
    }
    if (memUsers.some(u => u.email === input.email)) {
      const err: any = new Error('Duplicate email');
      err.code = 11000;
      throw err;
    }
    const id = newId();
    const created: StoredUser = {
      _id: id,
      id,
      name: input.name,
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: new Date(),
    };
    memUsers.push(created);
    return created;
  },

  // Items
  async listItems(filter: { status?: string; q?: string }): Promise<StoredItem[]> {
    if (isDbConnected()) {
      const query: any = {};
      if (filter.status) query.status = filter.status;
      if (filter.q) query.$text = { $search: filter.q };
      const docs = await Item.find(query).sort({ createdAt: -1 }).limit(100);
      return docs.map(toStoredItem);
    }
    const needle = filter.q?.trim().toLowerCase();
    return memItems
      .filter(item => {
        if (filter.status && item.status !== filter.status) return false;
        if (needle) {
          const hay = `${item.title} ${item.description} ${item.category} ${item.location}`.toLowerCase();
          if (!hay.includes(needle)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100);
  },

  async createItem(input: {
    title: string;
    description?: string;
    category?: string;
    location: string;
    status: 'Lost' | 'Found';
    imageUrl?: string;
    imageEmbedding?: number[];
    contact?: string;
    owner?: string | null;
    isDemo?: boolean;
  }): Promise<StoredItem> {
    if (isDbConnected()) {
      const doc = await Item.create(input);
      return toStoredItem(doc);
    }
    const id = newId();
    const now = new Date();
    const item: StoredItem = {
      _id: id,
      id,
      title: input.title,
      description: input.description || '',
      category: input.category || 'Personal items',
      location: input.location,
      status: input.status,
      imageUrl: input.imageUrl || '',
      imageEmbedding: input.imageEmbedding,
      reportedAt: now,
      owner: input.owner || null,
      contact: input.contact || '',
      isDemo: Boolean(input.isDemo),
      createdAt: now,
    };
    memItems.unshift(item);
    return item;
  },

  async findItemById(id: string): Promise<StoredItem | null> {
    if (isDbConnected()) {
      const doc = await Item.findById(id);
      return doc ? toStoredItem(doc) : null;
    }
    return memItems.find(item => item.id === id) ?? null;
  },

  async findOppositeItems(status: 'Lost' | 'Found', excludeId: string): Promise<StoredItem[]> {
    if (isDbConnected()) {
      const docs = await Item.find({ status, _id: { $ne: excludeId } }).limit(100);
      return docs.map(toStoredItem);
    }
    return memItems.filter(item => item.status === status && item.id !== excludeId).slice(0, 100);
  },

  async updateItemStatus(id: string, status: 'Claimed' | 'Resolved'): Promise<StoredItem | null> {
    if (isDbConnected()) {
      const doc = await Item.findByIdAndUpdate(id, { status }, { new: true });
      return doc ? toStoredItem(doc) : null;
    }
    const item = memItems.find(row => row.id === id);
    if (!item) return null;
    item.status = status;
    return item;
  },

  async countItems(): Promise<number> {
    if (isDbConnected()) return Item.countDocuments();
    return memItems.length;
  },

  async insertManyItems(docs: Array<{
    title: string;
    category: string;
    location: string;
    status: 'Lost' | 'Found';
    description: string;
    isDemo: boolean;
  }>): Promise<void> {
    if (isDbConnected()) {
      await Item.insertMany(docs);
      return;
    }
    for (const d of docs) {
      await store.createItem(d);
    }
  },

  // Notifications
  async createNotification(input: {
    user: string | null;
    title: string;
    message: string;
    type?: 'match' | 'bus' | 'alert' | 'system';
    relatedItem?: string | null;
  }): Promise<StoredNotification> {
    if (isDbConnected()) {
      const doc = await Notification.create(input);
      return {
        _id: String(doc._id),
        id: String(doc._id),
        user: doc.user ? String(doc.user) : null,
        title: doc.title,
        message: doc.message,
        type: doc.type as StoredNotification['type'],
        read: doc.read,
        relatedItem: doc.relatedItem ? String(doc.relatedItem) : null,
        createdAt: doc.createdAt,
      };
    }
    const id = newId();
    const row: StoredNotification = {
      _id: id,
      id,
      user: input.user,
      title: input.title,
      message: input.message,
      type: input.type || 'system',
      read: false,
      relatedItem: input.relatedItem || null,
      createdAt: new Date(),
    };
    memNotifications.unshift(row);
    return row;
  },

  async listNotificationsByUser(userId: string): Promise<StoredNotification[]> {
    if (isDbConnected()) {
      const docs = await Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(50);
      return docs.map(doc => ({
        _id: String(doc._id),
        id: String(doc._id),
        user: doc.user ? String(doc.user) : null,
        title: doc.title,
        message: doc.message,
        type: doc.type as StoredNotification['type'],
        read: doc.read,
        relatedItem: doc.relatedItem ? String(doc.relatedItem) : null,
        createdAt: doc.createdAt,
      }));
    }
    return memNotifications
      .filter(n => n.user === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50);
  },

  async markNotificationRead(id: string, userId: string): Promise<StoredNotification | null> {
    if (isDbConnected()) {
      const doc = await Notification.findOneAndUpdate({ _id: id, user: userId }, { read: true }, { new: true });
      if (!doc) return null;
      return {
        _id: String(doc._id),
        id: String(doc._id),
        user: doc.user ? String(doc.user) : null,
        title: doc.title,
        message: doc.message,
        type: doc.type as StoredNotification['type'],
        read: doc.read,
        relatedItem: doc.relatedItem ? String(doc.relatedItem) : null,
        createdAt: doc.createdAt,
      };
    }
    const row = memNotifications.find(n => n._id === id && n.user === userId);
    if (!row) return null;
    row.read = true;
    return row;
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    if (isDbConnected()) {
      await Notification.updateMany({ user: userId, read: false }, { read: true });
      return;
    }
    for (const row of memNotifications) {
      if (row.user === userId && !row.read) row.read = true;
    }
  },

  // Shuttles
  async listShuttles(onlyActive: boolean): Promise<StoredShuttle[]> {
    if (isDbConnected()) {
      const docs = await Shuttle.find(onlyActive ? { active: true } : {}).sort({ code: 1 });
      return docs.map(doc => ({
        _id: String(doc._id),
        id: String(doc._id),
        code: doc.code,
        routeName: doc.routeName,
        origin: doc.origin,
        destination: doc.destination,
        stops: doc.stops,
        latitude: doc.latitude ?? undefined,
        longitude: doc.longitude ?? undefined,
        heading: doc.heading ?? undefined,
        speedKmph: doc.speedKmph ?? undefined,
        lastGpsAt: doc.lastGpsAt ?? undefined,
        active: doc.active,
        driver: doc.driver ? String(doc.driver) : null,
      }));
    }
    return memShuttles
      .filter(s => (onlyActive ? s.active : true))
      .sort((a, b) => a.code.localeCompare(b.code));
  },

  async createShuttleRoute(route: {
    code: string;
    routeName: string;
    origin: string;
    destination: string;
    stops: string[];
  }): Promise<StoredShuttle> {
    const normalizedCode = route.code.trim().toUpperCase();
    if (isDbConnected()) {
      const existing = await Shuttle.findOne({ code: normalizedCode });
      if (existing) {
        const err: any = new Error(`Shuttle route ${normalizedCode} already exists`);
        err.statusCode = 409;
        throw err;
      }
      const doc = await Shuttle.create({
        code: normalizedCode,
        routeName: route.routeName,
        origin: route.origin,
        destination: route.destination,
        stops: route.stops,
        active: true,
      });
      return {
        _id: String(doc._id),
        id: String(doc._id),
        code: doc.code,
        routeName: doc.routeName,
        origin: doc.origin,
        destination: doc.destination,
        stops: doc.stops,
        active: doc.active,
        driver: null,
      };
    }
    if (memShuttles.some(s => s.code === normalizedCode)) {
      const err: any = new Error(`Shuttle route ${normalizedCode} already exists`);
      err.statusCode = 409;
      throw err;
    }
    const id = newId();
    const created: StoredShuttle = {
      _id: id,
      id,
      code: normalizedCode,
      routeName: route.routeName,
      origin: route.origin,
      destination: route.destination,
      stops: route.stops,
      active: true,
      driver: null,
    };
    memShuttles.push(created);
    return created;
  },

  async updateShuttleLocation(
    code: string,
    coords: { latitude: number; longitude: number; heading?: number; speedKmph?: number; lastGpsAt?: Date; driver?: string }
  ): Promise<StoredShuttle | null> {
    const gpsAt = coords.lastGpsAt ?? new Date();
    if (isDbConnected()) {
      const unsetFields: Record<string, string> = {};
      const setFields: Record<string, unknown> = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        lastGpsAt: gpsAt,
        driver: coords.driver ?? null,
      };
      if (coords.heading !== undefined) setFields.heading = coords.heading;
      else unsetFields.heading = '';
      if (coords.speedKmph !== undefined) setFields.speedKmph = coords.speedKmph;
      else unsetFields.speedKmph = '';

      const updateQuery: Record<string, unknown> = { $set: setFields };
      if (Object.keys(unsetFields).length > 0) updateQuery.$unset = unsetFields;

      const doc = await Shuttle.findOneAndUpdate(
        { code: code.toUpperCase(), active: true },
        updateQuery,
        { new: true }
      );
      if (!doc) return null;
      return {
        _id: String(doc._id),
        id: String(doc._id),
        code: doc.code,
        routeName: doc.routeName,
        origin: doc.origin,
        destination: doc.destination,
        stops: doc.stops,
        latitude: doc.latitude ?? undefined,
        longitude: doc.longitude ?? undefined,
        heading: doc.heading ?? undefined,
        speedKmph: doc.speedKmph ?? undefined,
        lastGpsAt: doc.lastGpsAt ?? undefined,
        active: doc.active,
        driver: doc.driver ? String(doc.driver) : null,
      };
    }
    const shuttle = memShuttles.find(s => s.code === code.toUpperCase() && s.active);
    if (!shuttle) return null;
    shuttle.latitude = coords.latitude;
    shuttle.longitude = coords.longitude;
    shuttle.heading = coords.heading;
    shuttle.speedKmph = coords.speedKmph;
    shuttle.lastGpsAt = gpsAt;
    shuttle.driver = coords.driver ?? null;
    return shuttle;
  },

  async stopShuttleLocation(code: string): Promise<StoredShuttle | null> {
    if (isDbConnected()) {
      const doc = await Shuttle.findOneAndUpdate(
        { code: code.toUpperCase(), active: true },
        {
          $unset: {
            latitude: '',
            longitude: '',
            heading: '',
            speedKmph: '',
            lastGpsAt: '',
          },
          $set: { driver: null },
        },
        { new: true }
      );
      if (!doc) return null;
      return {
        _id: String(doc._id),
        id: String(doc._id),
        code: doc.code,
        routeName: doc.routeName,
        origin: doc.origin,
        destination: doc.destination,
        stops: doc.stops,
        active: doc.active,
        driver: null,
      };
    }
    const shuttle = memShuttles.find(s => s.code === code.toUpperCase() && s.active);
    if (!shuttle) return null;
    shuttle.latitude = undefined;
    shuttle.longitude = undefined;
    shuttle.heading = undefined;
    shuttle.speedKmph = undefined;
    shuttle.lastGpsAt = undefined;
    shuttle.driver = null;
    return shuttle;
  },

  async findStaleShuttles(staleBefore: Date): Promise<Array<{ code: string; lastGpsAt?: Date }>> {
    if (isDbConnected()) {
      const docs = await Shuttle.find({ active: true, lastGpsAt: { $lt: staleBefore } }).select('code lastGpsAt');
      return docs.map(d => ({ code: d.code, lastGpsAt: d.lastGpsAt ?? undefined }));
    }
    return memShuttles
      .filter(s => s.active && s.lastGpsAt && s.lastGpsAt < staleBefore)
      .map(s => ({ code: s.code, lastGpsAt: s.lastGpsAt }));
  },

  async getInsights(): Promise<InsightsData> {
    if (isDbConnected()) {
      const [facetResult] = await Item.aggregate([
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalReports: { $sum: 1 },
                  itemsRecovered: {
                    $sum: { $cond: [{ $in: ['$status', ['Claimed', 'Resolved']] }, 1, 0] },
                  },
                  lostReports: {
                    $sum: { $cond: [{ $eq: ['$status', 'Lost'] }, 1, 0] },
                  },
                  foundReports: {
                    $sum: { $cond: [{ $eq: ['$status', 'Found'] }, 1, 0] },
                  },
                },
              },
            ],
            monthly: [
              {
                $project: {
                  status: 1,
                  reportDate: { $ifNull: ['$reportedAt', '$createdAt'] },
                },
              },
              {
                $match: { reportDate: { $type: 'date' } },
              },
              {
                $group: {
                  _id: { $dateToString: { format: '%Y-%m', date: '$reportDate', timezone: 'UTC' } },
                  total: { $sum: 1 },
                  lost: { $sum: { $cond: [{ $eq: ['$status', 'Lost'] }, 1, 0] } },
                  found: { $sum: { $cond: [{ $eq: ['$status', 'Found'] }, 1, 0] } },
                  recovered: { $sum: { $cond: [{ $in: ['$status', ['Claimed', 'Resolved']] }, 1, 0] } },
                },
              },
              { $sort: { _id: -1 } },
              { $limit: 12 },
              { $sort: { _id: 1 } },
            ],
            locations: [
              {
                $project: {
                  status: 1,
                  trimmedLocation: { $trim: { input: { $ifNull: ['$location', ''] } } },
                },
              },
              {
                $match: { trimmedLocation: { $ne: '' } },
              },
              {
                $group: {
                  _id: { $toLower: '$trimmedLocation' },
                  location: { $first: '$trimmedLocation' },
                  total: { $sum: 1 },
                  lost: { $sum: { $cond: [{ $eq: ['$status', 'Lost'] }, 1, 0] } },
                  found: { $sum: { $cond: [{ $eq: ['$status', 'Found'] }, 1, 0] } },
                  recovered: { $sum: { $cond: [{ $in: ['$status', ['Claimed', 'Resolved']] }, 1, 0] } },
                },
              },
              { $sort: { total: -1, location: 1 } },
              { $limit: 10 },
            ],
          },
        },
      ]);

      const rawSummary = facetResult?.summary?.[0] ?? {
        totalReports: 0,
        itemsRecovered: 0,
        lostReports: 0,
        foundReports: 0,
      };
      const totalReports = Number(rawSummary.totalReports) || 0;
      const itemsRecovered = Number(rawSummary.itemsRecovered) || 0;
      const lostReports = Number(rawSummary.lostReports) || 0;
      const foundReports = Number(rawSummary.foundReports) || 0;
      const recoveryRate = totalReports > 0 ? Math.round((itemsRecovered / totalReports) * 100) : 0;

      const monthlyTrends: MonthlyInsightTrend[] = (facetResult?.monthly ?? []).map((entry: any) => ({
        key: String(entry._id),
        label: formatMonthLabel(String(entry._id)),
        total: Number(entry.total) || 0,
        lost: Number(entry.lost) || 0,
        found: Number(entry.found) || 0,
        recovered: Number(entry.recovered) || 0,
      }));

      const locationStats: LocationInsightStat[] = (facetResult?.locations ?? []).map((entry: any) => ({
        location: String(entry.location),
        total: Number(entry.total) || 0,
        lost: Number(entry.lost) || 0,
        found: Number(entry.found) || 0,
        recovered: Number(entry.recovered) || 0,
      }));

      return {
        summary: {
          totalReports,
          itemsRecovered,
          lostReports,
          foundReports,
          recoveryRate,
        },
        monthlyTrends,
        locationStats,
        hasShuttleTripData: false,
        generatedAt: new Date().toISOString(),
      };
    }

    let itemsRecovered = 0;
    let lostReports = 0;
    let foundReports = 0;
    const monthBuckets = new Map<string, MonthlyInsightTrend>();
    const locationBuckets = new Map<string, LocationInsightStat>();

    for (const item of memItems) {
      const isRecovered = item.status === 'Claimed' || item.status === 'Resolved';
      const isLost = item.status === 'Lost';
      const isFound = item.status === 'Found';

      if (isRecovered) itemsRecovered += 1;
      if (isLost) lostReports += 1;
      if (isFound) foundReports += 1;

      const date = item.reportedAt || item.createdAt;
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const key = `${year}-${month}`;
        const bucket = monthBuckets.get(key) ?? {
          key,
          label: formatMonthLabel(key),
          total: 0,
          lost: 0,
          found: 0,
          recovered: 0,
        };
        bucket.total += 1;
        if (isLost) bucket.lost += 1;
        if (isFound) bucket.found += 1;
        if (isRecovered) bucket.recovered += 1;
        monthBuckets.set(key, bucket);
      }

      const trimmedLocation = item.location.trim();
      if (trimmedLocation) {
        const locKey = trimmedLocation.toLowerCase();
        const locBucket = locationBuckets.get(locKey) ?? {
          location: trimmedLocation,
          total: 0,
          lost: 0,
          found: 0,
          recovered: 0,
        };
        locBucket.total += 1;
        if (isLost) locBucket.lost += 1;
        if (isFound) locBucket.found += 1;
        if (isRecovered) locBucket.recovered += 1;
        locationBuckets.set(locKey, locBucket);
      }
    }

    const totalReports = memItems.length;
    const recoveryRate = totalReports > 0 ? Math.round((itemsRecovered / totalReports) * 100) : 0;

    const monthlyTrends = [...monthBuckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12);

    const locationStats = [...locationBuckets.values()]
      .sort((a, b) => b.total - a.total || a.location.localeCompare(b.location))
      .slice(0, 10);

    return {
      summary: {
        totalReports,
        itemsRecovered,
        lostReports,
        foundReports,
        recoveryRate,
      },
      monthlyTrends,
      locationStats,
      hasShuttleTripData: false,
      generatedAt: new Date().toISOString(),
    };
  },
};
