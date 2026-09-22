import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import '../widgets/cover_art.dart';
import '../widgets/login_sheet.dart';
import 'booking_detail_screen.dart';
import 'shell.dart';

/// My Events: Upcoming / Past.
class BookingsScreen extends StatefulWidget {
  const BookingsScreen({super.key});
  @override
  State<BookingsScreen> createState() => BookingsScreenState();
}

class BookingsScreenState extends State<BookingsScreen> {
  Future<Map<String, List<Booking>>>? _future;
  bool? _wasLoggedIn;

  void reload() {
    if (!context.read<AppState>().loggedIn) return;
    setState(() {
      _future = Api.instance.get('/bookings').then((r) => {
            'upcoming': (r['upcoming'] as List).map((e) => Booking(Map<String, dynamic>.from(e))).toList(),
            'past': (r['past'] as List).map((e) => Booking(Map<String, dynamic>.from(e))).toList(),
          });
    });
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    if (_wasLoggedIn != app.loggedIn) {
      _wasLoggedIn = app.loggedIn;
      if (app.loggedIn) WidgetsBinding.instance.addPostFrameCallback((_) => reload());
    }
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('My Events', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900)),
          bottom: app.loggedIn
              ? const TabBar(
                  labelColor: Brand.teal,
                  indicatorColor: Brand.teal,
                  labelStyle: TextStyle(fontWeight: FontWeight.w800),
                  tabs: [Tab(text: 'Upcoming'), Tab(text: 'Past')],
                )
              : null,
        ),
        body: !app.loggedIn
            ? EmptyView(
                icon: Icons.event_note_rounded,
                title: 'Your events live here',
                message: 'Sign in to see bookings, payments and invoices.',
                action: FilledButton(onPressed: () => showLoginSheet(context), child: const Text('Sign in')),
              )
            : FutureBuilder<Map<String, List<Booking>>>(
                future: _future,
                builder: (context, snap) {
                  if (snap.hasError) return ErrorView(error: snap.error!, onRetry: reload);
                  if (!snap.hasData) return const LoadingView();
                  return TabBarView(children: [
                    _List(items: snap.data!['upcoming']!, empty: 'No upcoming events', onRefresh: () async => reload()),
                    _List(items: snap.data!['past']!, empty: 'No past events yet', onRefresh: () async => reload()),
                  ]);
                },
              ),
      ),
    );
  }
}

class _List extends StatelessWidget {
  final List<Booking> items;
  final String empty;
  final Future<void> Function() onRefresh;
  const _List({required this.items, required this.empty, required this.onRefresh});

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return EmptyView(
        icon: Icons.celebration_rounded,
        title: empty,
        message: 'Find a venue and check real availability in a few taps.',
        action: OutlinedButton(onPressed: () => Shell.goTo(0), child: const Text('Find a venue')),
      );
    }
    return RefreshIndicator(
      onRefresh: onRefresh,
      color: Brand.teal,
      child: ListView.separated(
        padding: const EdgeInsets.all(16),
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (context, i) => BookingTile(items[i]),
      ),
    );
  }
}

class BookingTile extends StatelessWidget {
  final Booking b;
  const BookingTile(this.b, {super.key});
  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: () async {
        await Navigator.of(context).push(MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: b.id)));
        if (context.mounted) context.findAncestorStateOfType<BookingsScreenState>()?.reload();
      },
      child: Panel(
        margin: EdgeInsets.zero,
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          SizedBox(width: 74, height: 74, child: CoverArt(hue: b.venueHue, seed: b.venue['id'] ?? b.id, radius: 14)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Expanded(child: Text(app.categoryName(b.eventType), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                StatusPill(b.status, b.statusLabel),
              ]),
              const SizedBox(height: 3),
              Text(dateWithDay(b.eventDate), style: const TextStyle(fontWeight: FontWeight.w700)),
              Text('${b.venueName} · ${b.spaceName}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Brand.inkSoft, fontSize: 13)),
              const SizedBox(height: 3),
              Text(
                b.awaitingPayment ? 'Advance due ${inr(b.advance - b.paid)}' : 'Paid ${inr(b.paid)}${b.balance > 0 && b.isLive ? ' · ${inr(b.balance)} at venue' : ''}',
                style: TextStyle(color: b.awaitingPayment ? const Color(0xFFA86400) : Brand.muted, fontSize: 12.5, fontWeight: FontWeight.w600),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}
