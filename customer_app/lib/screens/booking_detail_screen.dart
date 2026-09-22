import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'booking_flow.dart';
import 'venue_screen.dart';

class BookingDetailScreen extends StatefulWidget {
  final String bookingId;
  const BookingDetailScreen({super.key, required this.bookingId});
  @override
  State<BookingDetailScreen> createState() => _BookingDetailScreenState();
}

class _BookingDetailScreenState extends State<BookingDetailScreen> {
  late Future<Booking> _future;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() => _future = Api.instance.get('/bookings/${widget.bookingId}').then((r) => Booking(Map<String, dynamic>.from(r)));

  Future<void> _cancel(Booking b) async {
    final c = b.cancellation;
    final reason = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(24, 0, 24, MediaQuery.of(ctx).viewInsets.bottom + 24),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Cancel this booking?', style: Theme.of(ctx).textTheme.headlineSmall),
          const SizedBox(height: 12),
          if (b.paid > 0) ...[
            Panel(
              margin: EdgeInsets.zero,
              child: Column(children: [
                if (c['rule'] != null) KeyValueRow('Policy', '${c['rule']['label']} · ${c['rule']['refund_pct']}%'),
                if (c['days_before'] != null) KeyValueRow('Days before event', '${c['days_before']}'),
                KeyValueRow('Paid', inr(b.paid)),
                KeyValueRow('Refund', inr(c['refund_amount'] ?? 0), bold: true, color: Brand.available),
                if ((c['retained_amount'] ?? 0) > 0) KeyValueRow('Non-refundable', inr(c['retained_amount'])),
              ]),
            ),
            const SizedBox(height: 8),
            const Text('Refunds go back to your original payment method in 5–7 working days.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
          ] else
            const Text('Nothing has been paid yet, so there is no charge. The slot will be released.', style: TextStyle(color: Brand.inkSoft)),
          const SizedBox(height: 12),
          TextField(controller: reason, decoration: const InputDecoration(labelText: 'Reason (optional)')),
          const SizedBox(height: 16),
          Row(children: [
            Expanded(child: OutlinedButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep booking'))),
            const SizedBox(width: 10),
            Expanded(child: FilledButton(style: FilledButton.styleFrom(backgroundColor: Brand.danger), onPressed: () => Navigator.pop(ctx, true), child: const Text('Cancel booking'))),
          ]),
        ]),
      ),
    );
    if (ok != true || !mounted) return;
    try {
      await Api.instance.post('/bookings/${b.id}/cancel', {'reason': reason.text.trim().isEmpty ? null : reason.text.trim()});
      if (!mounted) return;
      toast(context, 'Booking cancelled');
      setState(_load);
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Booking')),
      body: FutureBuilder<Booking>(
        future: _future,
        builder: (context, snap) {
          if (snap.hasError) return ErrorView(error: snap.error!, onRetry: () => setState(_load));
          if (!snap.hasData) return const LoadingView();
          final b = snap.data!;
          final hold = DateTime.tryParse(b.holdExpiresAt ?? '');
          return RefreshIndicator(
            color: Brand.teal,
            onRefresh: () async {
              setState(_load);
              await _future;
            },
            child: ListView(padding: const EdgeInsets.only(bottom: 40), children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Booking #${b.code}', style: const TextStyle(color: Brand.inkSoft, fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  StatusPill(b.status, b.statusLabel),
                  if (b.awaitingPayment && hold != null && hold.isAfter(DateTime.now())) ...[
                    const SizedBox(height: 10),
                    Text('Slot held until ${TimeOfDay.fromDateTime(hold.toLocal()).format(context)} — pay the advance to confirm.', style: const TextStyle(color: Color(0xFFA86400), fontWeight: FontWeight.w700)),
                  ],
                  if (b.status == 'REQUESTED')
                    const Padding(padding: EdgeInsets.only(top: 10), child: Text('Waiting for the venue to accept. You will be notified.', style: TextStyle(color: Brand.inkSoft))),
                  if (b.cancelReason != null)
                    Padding(padding: const EdgeInsets.only(top: 8), child: Text('Reason: ${b.cancelReason}', style: const TextStyle(color: Brand.inkSoft))),
                ]),
              ),
              Panel(
                child: Column(children: [
                  KeyValueRow('Venue', b.venueName, bold: true),
                  KeyValueRow('Space', b.spaceName),
                  KeyValueRow('Event', app.categoryName(b.eventType)),
                  KeyValueRow('Date', dateLong(b.eventDate)),
                  KeyValueRow('Time', '${b.slotLabel} · ${b.slotTime}'),
                  KeyValueRow('Guests', '${b.guests}'),
                  if (b.packageName != null) KeyValueRow('Package', b.packageName!),
                ]),
              ),
              const SizedBox(height: 12),
              Panel(
                child: Column(children: [
                  for (final l in b.items.where((l) => l.kind != 'tax'))
                    KeyValueRow(l.label.replaceFirst('Venue — ', 'Venue · ').replaceFirst('Package — ', 'Package · '), l.amount == 0 ? 'Included' : inr(l.amount)),
                  KeyValueRow('GST', inr(b.tax)),
                  const Padding(padding: EdgeInsets.symmetric(vertical: 6), child: Divider()),
                  KeyValueRow('Total', inr(b.total), bold: true),
                  KeyValueRow('Paid', inr(b.paid), color: Brand.available),
                  if (b.refunded > 0) KeyValueRow('Refunded', inr(b.refunded), color: Brand.available),
                  KeyValueRow(b.status == 'COMPLETED' ? 'Balance (settled at venue)' : 'Remaining', inr(b.balance)),
                ]),
              ),
              const SizedBox(height: 16),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  if (b.awaitingPayment)
                    FilledButton(
                      onPressed: () async {
                        try {
                          await startCheckout(context, b);
                          if (mounted) setState(_load);
                        } catch (e) {
                          if (context.mounted) toast(context, errorText(e));
                        }
                      },
                      child: Text('Pay advance ${inr(b.advance - b.paid)}'),
                    ),
                  if (b.canPayBalance)
                    FilledButton.tonal(
                      onPressed: () async {
                        try {
                          await startCheckout(context, b, purpose: 'balance');
                          if (mounted) setState(_load);
                        } catch (e) {
                          if (context.mounted) toast(context, errorText(e));
                        }
                      },
                      child: Text('Pay remaining ${inr(b.balance)} online'),
                    ),
                  if (b.canReview)
                    FilledButton.icon(
                      onPressed: () async {
                        final done = await Navigator.of(context).push<bool>(MaterialPageRoute(builder: (_) => ReviewScreen(booking: b)));
                        if (done == true && mounted) setState(_load);
                      },
                      icon: const Icon(Icons.star_rounded),
                      label: const Text('Rate your experience'),
                    ),
                  const SizedBox(height: 8),
                  Row(children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: b.source == 'online' ? () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => MessagesScreen(booking: b))) : null,
                        icon: const Icon(Icons.chat_bubble_outline_rounded),
                        label: const Text('Contact Venue'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(child: OutlinedButton.icon(onPressed: () => openDirections(b.venueLat, b.venueLng), icon: const Icon(Icons.directions_rounded), label: const Text('Directions'))),
                  ]),
                  const SizedBox(height: 8),
                  if (b.paid > 0)
                    OutlinedButton.icon(
                      onPressed: () => launchUrl(Uri.parse(invoiceUrl(b.id)), mode: LaunchMode.externalApplication),
                      icon: const Icon(Icons.receipt_long_rounded),
                      label: const Text('Invoice'),
                    ),
                ]),
              ),
              if (b.review != null)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: Panel(
                    margin: EdgeInsets.zero,
                    child: Row(children: [
                      const Icon(Icons.star_rounded, color: Brand.marigold),
                      const SizedBox(width: 8),
                      Expanded(child: Text('You rated this ${b.review!['overall']}/5${b.review!['body'] != null ? ' — "${b.review!['body']}"' : ''}')),
                    ]),
                  ),
                ),
              if (b.isLive || b.awaitingPayment || b.status == 'REQUESTED') const SectionHeader('Cancellation'),
              if (b.isLive || b.awaitingPayment || b.status == 'REQUESTED') Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  for (final r in b.policy) KeyValueRow(r.label, r.refundPct == 0 ? 'No refund' : '${r.refundPct}% refund'),
                  if (b.cancellation['cancellable'] == true) ...[
                    const SizedBox(height: 8),
                    SizedBox(
                      width: double.infinity,
                      child: OutlinedButton(
                        style: OutlinedButton.styleFrom(foregroundColor: Brand.danger),
                        onPressed: () => _cancel(b),
                        child: Text(b.paid > 0 ? 'Cancel booking · refund ${inr(b.cancellation['refund_amount'] ?? 0)}' : 'Cancel booking'),
                      ),
                    ),
                  ],
                ]),
              ),
              const SectionHeader('Timeline'),
              Panel(
                child: Column(children: [
                  for (final h in b.history)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 6),
                      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        const Padding(padding: EdgeInsets.only(top: 4), child: Icon(Icons.circle, size: 10, color: Brand.teal)),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Text(titleCase(h['to_status'].toString().toLowerCase()), style: const TextStyle(fontWeight: FontWeight.w700)),
                            if (h['note'] != null) Text(h['note'], style: const TextStyle(color: Brand.inkSoft, fontSize: 12.5)),
                          ]),
                        ),
                        Text(relativeTime(h['at']), style: const TextStyle(color: Brand.muted, fontSize: 12)),
                      ]),
                    ),
                ]),
              ),
            ]),
          );
        },
      ),
    );
  }
}

// ─────────────────────────────── Messages (platform relay) ───────────────────────────────

class MessagesScreen extends StatefulWidget {
  final Booking booking;
  const MessagesScreen({super.key, required this.booking});
  @override
  State<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends State<MessagesScreen> {
  late Future<List<Map<String, dynamic>>> _future;
  final _c = TextEditingController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() => _future = Api.instance.get('/bookings/${widget.booking.id}/messages').then((r) => List<Map<String, dynamic>>.from(r['items']));

  Future<void> _send() async {
    if (_c.text.trim().isEmpty) return;
    setState(() => _sending = true);
    try {
      await Api.instance.post('/bookings/${widget.booking.id}/messages', {'body': _c.text.trim()});
      _c.clear();
      setState(_load);
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.booking.venueName)),
        body: Column(children: [
          Container(
            width: double.infinity,
            color: Brand.tealSoft,
            padding: const EdgeInsets.all(10),
            child: const Text('Messages go through Pandal. Phone numbers stay private.', textAlign: TextAlign.center, style: TextStyle(color: Brand.teal, fontSize: 12.5, fontWeight: FontWeight.w600)),
          ),
          Expanded(
            child: FutureBuilder<List<Map<String, dynamic>>>(
              future: _future,
              builder: (context, snap) {
                if (!snap.hasData) return const LoadingView();
                final items = snap.data!;
                if (items.isEmpty) return const EmptyView(icon: Icons.forum_outlined, title: 'Ask the venue anything', message: 'Menu options, décor themes, parking — they usually reply within a few hours.');
                return ListView(padding: const EdgeInsets.all(16), children: [
                  for (final m in items)
                    Align(
                      alignment: m['sender_role'] == 'customer' ? Alignment.centerRight : Alignment.centerLeft,
                      child: Container(
                        constraints: const BoxConstraints(maxWidth: 300),
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                        decoration: BoxDecoration(
                          color: m['sender_role'] == 'customer' ? Brand.teal : Colors.white,
                          borderRadius: BorderRadius.circular(16),
                          border: m['sender_role'] == 'customer' ? null : Border.all(color: Brand.line),
                        ),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(m['body'], style: TextStyle(color: m['sender_role'] == 'customer' ? Colors.white : Brand.ink)),
                          const SizedBox(height: 3),
                          Text('${m['sender_role'] == 'business' ? 'Venue · ' : m['sender_role'] == 'admin' ? 'Pandal support · ' : ''}${relativeTime(m['at'])}',
                              style: TextStyle(fontSize: 11, color: m['sender_role'] == 'customer' ? Colors.white70 : Brand.muted)),
                        ]),
                      ),
                    ),
                ]);
              },
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
              child: Row(children: [
                Expanded(child: TextField(controller: _c, minLines: 1, maxLines: 4, decoration: const InputDecoration(hintText: 'Message the venue', isDense: true))),
                const SizedBox(width: 8),
                IconButton.filled(onPressed: _sending ? null : _send, icon: const Icon(Icons.send_rounded), style: IconButton.styleFrom(backgroundColor: Brand.teal)),
              ]),
            ),
          ),
        ]),
      );
}

// ─────────────────────────────── Review ───────────────────────────────

class ReviewScreen extends StatefulWidget {
  final Booking booking;
  const ReviewScreen({super.key, required this.booking});
  @override
  State<ReviewScreen> createState() => _ReviewScreenState();
}

class _ReviewScreenState extends State<ReviewScreen> {
  int _overall = 0;
  final Map<String, int> _sub = {'venue': 0, 'food': 0, 'service': 0, 'cleanliness': 0, 'value': 0};
  final _body = TextEditingController();
  bool _busy = false;

  Future<void> _submit() async {
    setState(() => _busy = true);
    try {
      await Api.instance.post('/bookings/${widget.booking.id}/review', {
        'overall': _overall,
        for (final e in _sub.entries)
          if (e.value > 0) e.key: e.value,
        if (_body.text.trim().isNotEmpty) 'body': _body.text.trim(),
      });
      if (!mounted) return;
      toast(context, 'Thanks! Your review is live.');
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _stars(int value, ValueChanged<int> onChanged, {double size = 30}) => Row(mainAxisSize: MainAxisSize.min, children: [
        for (var i = 1; i <= 5; i++)
          GestureDetector(
            onTap: () => onChanged(i),
            child: Padding(padding: const EdgeInsets.symmetric(horizontal: 2), child: Icon(i <= value ? Icons.star_rounded : Icons.star_outline_rounded, color: Brand.marigold, size: size)),
          ),
      ]);

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Review')),
        body: ListView(padding: const EdgeInsets.all(20), children: [
          Text('How was your experience?', style: Theme.of(context).textTheme.headlineSmall),
          const SizedBox(height: 4),
          Text('${widget.booking.venueName} · ${dateLong(widget.booking.eventDate)}', style: const TextStyle(color: Brand.inkSoft)),
          const SizedBox(height: 18),
          Center(child: _stars(_overall, (v) => setState(() => _overall = v), size: 46)),
          const SizedBox(height: 18),
          Panel(
            margin: EdgeInsets.zero,
            child: Column(children: [
              for (final k in _sub.keys)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Row(children: [
                    Expanded(child: Text(titleCase(k), style: const TextStyle(fontWeight: FontWeight.w600))),
                    _stars(_sub[k]!, (v) => setState(() => _sub[k] = v), size: 24),
                  ]),
                ),
            ]),
          ),
          const SizedBox(height: 16),
          TextField(controller: _body, maxLines: 5, decoration: const InputDecoration(labelText: 'Write review', hintText: 'What stood out? Food, décor, staff, parking…')),
          const SizedBox(height: 8),
          const Text('Your review is marked "Verified booking". Only your first name and initial are shown.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
          const SizedBox(height: 20),
          FilledButton(onPressed: _overall == 0 || _busy ? null : _submit, child: const Text('Submit Review')),
        ]),
      );
}
