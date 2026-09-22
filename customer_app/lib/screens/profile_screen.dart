import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/config.dart';
import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import '../widgets/login_sheet.dart';
import '../widgets/venue_card.dart';
import 'booking_detail_screen.dart';
import 'location_screens.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final u = app.user;
    return Scaffold(
      appBar: AppBar(title: const Text('Profile', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900))),
      body: ListView(padding: const EdgeInsets.only(bottom: 32), children: [
        Panel(
          child: app.loggedIn
              ? Row(children: [
                  CircleAvatar(
                    radius: 28,
                    backgroundColor: Brand.marigold,
                    child: (u?['name'] as String?)?.isNotEmpty == true
                        ? Text((u!['name'] as String)[0].toUpperCase(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 22))
                        : const Icon(Icons.person_rounded, color: Colors.white),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(u?['name'] ?? 'Add your name', style: Theme.of(context).textTheme.titleLarge),
                      Text('+91 ${u?['phone'] ?? ''}', style: const TextStyle(color: Brand.inkSoft)),
                    ]),
                  ),
                  IconButton(icon: const Icon(Icons.edit_outlined), onPressed: () => _editName(context, app)),
                ])
              : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Plan events with Pandal', style: Theme.of(context).textTheme.titleLarge),
                  const SizedBox(height: 4),
                  const Text('Sign in to book venues, save favourites and keep your invoices in one place.', style: TextStyle(color: Brand.inkSoft)),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: () => showLoginSheet(context), child: const Text('Sign in with phone')),
                ]),
        ),
        const SizedBox(height: 12),
        _Tile(
          icon: Icons.location_on_outlined,
          title: 'Location',
          subtitle: app.location?.shortLabel ?? 'Not set',
          onTap: () async {
            final p = await Navigator.of(context).push<PlaceLocation>(MaterialPageRoute(builder: (_) => const LocationPickerScreen()));
            if (p != null && context.mounted) context.read<AppState>().setLocation(p);
          },
        ),
        if (app.loggedIn) ...[
          _Tile(icon: Icons.favorite_border_rounded, title: 'Saved venues', subtitle: '${app.savedIds.length} saved', onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SavedScreen()))),
          _Tile(
            icon: Icons.notifications_none_rounded,
            title: 'Notifications',
            subtitle: app.unreadNotifications > 0 ? '${app.unreadNotifications} unread' : 'All caught up',
            badge: app.unreadNotifications,
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationsScreen())),
          ),
        ],
        _Tile(icon: Icons.storefront_outlined, title: 'List your venue', subtitle: 'Own a banquet, lawn or farmhouse? Join Pandal for Business.', onTap: () => _info(context, 'Pandal for Business', 'Open ${AppConfig.apiBase.replaceAll(':4000', ':5173')}/business on a computer to register your venue, set prices and manage your calendar.')),
        _Tile(icon: Icons.help_outline_rounded, title: 'Help & support', subtitle: 'Cancellations, refunds, payments', onTap: () => _info(context, 'Help', 'Open a booking and tap "Contact Venue" for event questions. For payments and refunds, the booking timeline shows every step; refunds reach your original payment method in 5–7 working days.')),
        _Tile(icon: Icons.policy_outlined, title: 'How Pandal works', subtitle: 'Pricing, availability & reviews', onTap: () => _info(context, 'How Pandal works', '• Prices are calculated on our servers from the venue\'s own rate card — what you see is what you pay.\n• Availability is real: every hall, lawn and time slot is tracked separately, including the venue\'s offline bookings.\n• Your booking is confirmed only after we verify the payment with the gateway.\n• Only guests with a completed booking can leave a review.')),
        if (app.loggedIn)
          _Tile(
            icon: Icons.logout_rounded,
            title: 'Sign out',
            danger: true,
            onTap: () async {
              await context.read<AppState>().signOut();
              if (context.mounted) toast(context, 'Signed out');
            },
          ),
        const SizedBox(height: 20),
        const Center(child: Wordmark(size: 22)),
        const SizedBox(height: 4),
        Center(child: Text('v0.1 · ${AppConfig.apiBase}', style: const TextStyle(color: Brand.muted, fontSize: 11.5))),
      ]),
    );
  }

  Future<void> _editName(BuildContext context, AppState app) async {
    final c = TextEditingController(text: app.user?['name'] ?? '');
    final name = await showDialog<String>(
      context: context,
      builder: (d) => AlertDialog(
        title: const Text('Your name'),
        content: TextField(controller: c, autofocus: true, textCapitalization: TextCapitalization.words),
        actions: [TextButton(onPressed: () => Navigator.pop(d), child: const Text('Cancel')), FilledButton(onPressed: () => Navigator.pop(d, c.text.trim()), child: const Text('Save'))],
      ),
    );
    if (name != null && name.isNotEmpty) {
      try {
        await app.updateName(name);
      } catch (e) {
        if (context.mounted) toast(context, errorText(e));
      }
    }
  }

  void _info(BuildContext context, String title, String body) => showModalBottomSheet(
        context: context,
        builder: (c) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: Theme.of(c).textTheme.titleLarge),
              const SizedBox(height: 10),
              Text(body, style: const TextStyle(height: 1.5)),
            ]),
          ),
        ),
      );
}

class _Tile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final VoidCallback onTap;
  final bool danger;
  final int badge;
  const _Tile({required this.icon, required this.title, this.subtitle, required this.onTap, this.danger = false, this.badge = 0});
  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
        leading: Badge(isLabelVisible: badge > 0, label: Text('$badge'), child: Icon(icon, color: danger ? Brand.danger : Brand.teal)),
        title: Text(title, style: TextStyle(fontWeight: FontWeight.w700, color: danger ? Brand.danger : Brand.ink)),
        subtitle: subtitle == null ? null : Text(subtitle!, maxLines: 2, overflow: TextOverflow.ellipsis),
        trailing: danger ? null : const Icon(Icons.chevron_right_rounded),
        onTap: onTap,
      );
}

class SavedScreen extends StatelessWidget {
  const SavedScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final loc = app.location;
    return Scaffold(
      appBar: AppBar(title: const Text('Saved venues')),
      body: FutureBuilder(
        // Re-fetch whenever the saved set changes.
        key: ValueKey(app.savedIds.length),
        future: Api.instance.get('/saved', {if (loc != null) 'lat': loc.lat, if (loc != null) 'lng': loc.lng}),
        builder: (context, snap) {
          if (snap.hasError) return ErrorView(error: snap.error!, onRetry: () => app.refreshSaved());
          if (!snap.hasData) return const LoadingView();
          final items = ((snap.data as Map)['items'] as List).map((e) => VenueCard.fromJson(Map<String, dynamic>.from(e))).toList();
          if (items.isEmpty) return const EmptyView(icon: Icons.favorite_border_rounded, title: 'No saved venues yet', message: 'Tap the heart on any venue to keep it here.');
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: items.length,
            separatorBuilder: (_, __) => const SizedBox(height: 16),
            itemBuilder: (_, i) => VenueListCard(items[i]),
          );
        },
      ),
    );
  }
}

class NotificationsScreen extends StatefulWidget {
  const NotificationsScreen({super.key});
  @override
  State<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends State<NotificationsScreen> {
  late Future<List<AppNotification>> _future;

  @override
  void initState() {
    super.initState();
    _future = Api.instance.get('/notifications').then((r) => (r['items'] as List).map((e) => AppNotification.fromJson(Map<String, dynamic>.from(e))).toList());
    Api.instance.post('/notifications/read').then((_) {
      if (mounted) context.read<AppState>().refreshUnread();
    }).catchError((_) {});
  }

  IconData _icon(String type) => switch (type) {
        'booking_confirmed' || 'booking_accepted' => Icons.verified_rounded,
        'payment_received' => Icons.payments_rounded,
        'payment_failed' => Icons.error_outline_rounded,
        'event_reminder' => Icons.alarm_rounded,
        'booking_cancelled' || 'booking_rejected' => Icons.event_busy_rounded,
        'refund_processed' => Icons.currency_rupee_rounded,
        'review_reminder' => Icons.star_rounded,
        'message' => Icons.chat_bubble_rounded,
        _ => Icons.notifications_rounded,
      };

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Notifications')),
        body: FutureBuilder<List<AppNotification>>(
          future: _future,
          builder: (context, snap) {
            if (!snap.hasData) return const LoadingView();
            final items = snap.data!;
            if (items.isEmpty) return const EmptyView(icon: Icons.notifications_none_rounded, title: 'Nothing yet', message: 'Booking updates, reminders and refunds will show up here.');
            return ListView.separated(
              itemCount: items.length,
              separatorBuilder: (_, __) => const Divider(indent: 72),
              itemBuilder: (_, i) {
                final n = items[i];
                return ListTile(
                  leading: CircleAvatar(backgroundColor: n.readAt == null ? Brand.marigoldSoft : Brand.tealSoft, child: Icon(_icon(n.type), color: n.readAt == null ? Brand.marigold : Brand.teal)),
                  title: Text(n.title, style: TextStyle(fontWeight: n.readAt == null ? FontWeight.w800 : FontWeight.w600)),
                  subtitle: Text('${n.body}\n${relativeTime(n.createdAt)}'),
                  isThreeLine: true,
                  onTap: n.data['booking_id'] == null ? null : () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: n.data['booking_id']))),
                );
              },
            );
          },
        ),
      );
}
