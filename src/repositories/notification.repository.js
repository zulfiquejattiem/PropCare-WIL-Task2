/**
 * NotificationRepository - the per-user in-app activity feed.
 */
const { BaseRepository } = require('./base.repository');

class NotificationRepository extends BaseRepository {
  forUser(userId) {
    return this.all(
      'SELECT id, icon, title, created_at, read FROM notifications WHERE user_id = ? ORDER BY created_at DESC',
      userId
    );
  }

  insert({ userId, icon, title, createdAt }) {
    this.run(
      'INSERT INTO notifications (user_id, icon, title, created_at, read) VALUES (?, ?, ?, ?, 0)',
      userId, icon, title, createdAt
    );
  }

  markAllRead(userId) {
    this.run('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0', userId);
  }

  unreadCount(userId) {
    return this.count('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0', userId);
  }
}

module.exports = { NotificationRepository };
