import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/config.dart';
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
import 'venue_screen.dart';

/// Everything the customer picked, sent to the server as ids — never prices.
class BookingDraft {
  final VenueDetail venue;
  String eventType;
  String date;
  String slot;
  int guests;
  String spaceId;
  String? packageId;
  final Set<String> serviceIds = {};
  String? coupon;
  String? notes;
  // One key per checkout attempt: retries never create a second booking.
  final String idempotencyKey = Api.newIdempotencyKey();

  BookingDraft({required this.venue, required this.eventType, required this.date, required this.slot, required this.guests, required this.spaceId});

  Space get space => venue.spaces.firstWhere((s) => s.id == spaceId);
  VenuePackage? get package => packageId == null ? null : venue.packages.firstWhere((p) => p.id == packageId);

  Map<String, dynamic> toBody() => {
        'venue_id': venue.id,
        'space_id': spaceId,
        'date': date,
        'slot': slot,
        'guests': guests,
        'event_type': eventType,
        'package_id': packageId,
        'service_ids': serviceIds.toList(),
        'coupon_code': coupon,
      };
}

class _StepHeader extends StatelessWidget {
  final int step;
  final String title;
  const _StepHeader(this.step, this.title);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            for (var i = 1; i <= 3; i++)
              Expanded(
                child: Container(
                  height: 4,
                  margin: const EdgeInsets.only(right: 4),
                  decoration: BoxDecoration(color: i <= step ? Brand.teal : Brand.line, borderRadius: BorderRadius.circular(2)),
                ),
              ),
          ]),
          const SizedBox(height: 14),
          Text('Step $step of 3', style: const TextStyle(color: Brand.muted, fontWeight: FontWeight.w700, fontSize: 12.5)),
          Text(title, style: Theme.of(context).textTheme.headlineSmall),
        ]),
      );
}

class _EventStrip extends StatelessWidget {
  final BookingDraft d;
  const _EventStrip(this.d);
  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    return Panel(
      padding: const EdgeInsets.all(12),
      child: Row(children: [
        SizedBox(width: 52, height: 52, child: CoverArt(hue: d.venue.card.coverHue, seed: d.venue.id, imageUrl: d.venue.card.coverImage, radius: 12)),
        const SizedBox(width: 12),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${d.venue.name} · ${d.space.name}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 2),
            Text('${app.categoryName(d.eventType)} · ${dateWithDay(d.date)} · ${titleCase(d.slot.toLowerCase())} · ${d.guests} guests',
                style: const TextStyle(color: Brand.inkSoft, fontSize: 12.5)),
          ]),
        ),
      ]),
    );
  }
}

// ─────────────────────────────── Step 1: package ───────────────────────────────

class PackageScreen extends StatefulWidget {
  final BookingDraft draft;
  const PackageScreen({super.key, required this.draft});
  @override
  State<PackageScreen> createState() => _PackageScreenState();
}

class _PackageScreenState extends State<PackageScreen> {
  BookingDraft get d => widget.draft;

  @override
  void initState() {
    super.initState();
    d.packageId ??= d.venue.packages.isEmpty ? null : d.venue.packages.first.id;
  }

  String _price(VenuePackage p) => switch (p.pricingMode) {
        'included' => 'Included with the venue',
        'per_plate' => '${inr(p.price)} × ${d.guests < p.minGuests ? p.minGuests : d.guests} plates = ${inr(p.price * (d.guests < p.minGuests ? p.minGuests : d.guests))}',
        _ => '+ ${inr(p.price)}',
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Book')),
      body: ListView(padding: const EdgeInsets.only(bottom: 110), children: [
        const _StepHeader(1, 'Select a package'),
        _EventStrip(d),
        const SizedBox(height: 14),
        for (final p in d.venue.packages)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
            child: Material(
              color: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18), side: BorderSide(color: d.packageId == p.id ? Brand.teal : Brand.line, width: d.packageId == p.id ? 2 : 1)),
              child: InkWell(
                borderRadius: BorderRadius.circular(18),
                onTap: () => setState(() {
                  d.packageId = p.id;
                  d.serviceIds.removeWhere((sid) => p.includes(d.venue.services.firstWhere((s) => s.id == sid).category));
                }),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      Icon(d.packageId == p.id ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded, color: Brand.teal),
                      const SizedBox(width: 10),
                      Expanded(child: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17))),
                      if (p.tier == 'premium')
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                          decoration: BoxDecoration(color: Brand.marigoldSoft, borderRadius: BorderRadius.circular(8)),
                          child: const Text('MOST BOOKED', style: TextStyle(color: Color(0xFFA86400), fontSize: 10.5, fontWeight: FontWeight.w900)),
                        ),
                    ]),
                    Padding(padding: const EdgeInsets.only(left: 34, top: 4), child: Text(_price(p), style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.teal))),
                    if (p.description.isNotEmpty) Padding(padding: const EdgeInsets.only(left: 34, top: 4), child: Text(p.description, style: const TextStyle(color: Brand.inkSoft, fontSize: 13))),
                    const SizedBox(height: 8),
                    Padding(
                      padding: const EdgeInsets.only(left: 34),
                      child: Wrap(spacing: 6, runSpacing: 6, children: [
                        for (final i in p.inclusions)
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(color: Brand.cream, borderRadius: BorderRadius.circular(8)),
                            child: Text(i.label, style: const TextStyle(fontSize: 12)),
                          ),
                      ]),
                    ),
                  ]),
                ),
              ),
            ),
          ),
      ]),
      bottomNavigationBar: _BottomCta(
        label: 'Continue',
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ServicesScreen(draft: d))),
      ),
    );
  }
}

// ─────────────────────────────── Step 2: services ───────────────────────────────

class ServicesScreen extends StatefulWidget {
  final BookingDraft draft;
  const ServicesScreen({super.key, required this.draft});
  @override
  State<ServicesScreen> createState() => _ServicesScreenState();
}

class _ServicesScreenState extends State<ServicesScreen> {
  BookingDraft get d => widget.draft;

  @override
  Widget build(BuildContext context) {
    final pkg = d.package;
    return Scaffold(
      appBar: AppBar(title: const Text('Book')),
      body: ListView(padding: const EdgeInsets.only(bottom: 110), children: [
        const _StepHeader(2, 'Add services'),
        _EventStrip(d),
        const SizedBox(height: 6),
        const Padding(
          padding: EdgeInsets.fromLTRB(20, 8, 20, 8),
          child: Text('Optional. Prices are the venue\'s own; you\'ll see the full total before paying.', style: TextStyle(color: Brand.inkSoft)),
        ),
        for (final s in d.venue.services)
          Builder(builder: (context) {
            final included = pkg?.includes(s.category) ?? false;
            final checked = d.serviceIds.contains(s.id);
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Panel(
                margin: EdgeInsets.zero,
                padding: EdgeInsets.zero,
                child: CheckboxListTile(
                  value: included || checked,
                  onChanged: included ? null : (v) => setState(() => v == true ? d.serviceIds.add(s.id) : d.serviceIds.remove(s.id)),
                  activeColor: Brand.teal,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                  title: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    if (s.description.isNotEmpty) Text(s.description, style: const TextStyle(fontSize: 12.5)),
                    const SizedBox(height: 2),
                    Text(
                      included
                          ? 'Included in ${pkg!.name}'
                          : s.pricingMode == 'per_guest'
                              ? '${inr(s.price)} × ${d.guests} guests = ${inr(s.price * d.guests)}'
                              : inr(s.price),
                      style: TextStyle(fontWeight: FontWeight.w700, color: included ? Brand.available : Brand.teal),
                    ),
                  ]),
                ),
              ),
            );
          }),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 6, 16, 0),
          child: TextField(
            maxLines: 3,
            onChanged: (v) => d.notes = v,
            decoration: const InputDecoration(labelText: 'Notes for the venue (optional)', hintText: 'e.g. Jain food for 40 guests, early setup at 3 PM'),
          ),
        ),
      ]),
      bottomNavigationBar: _BottomCta(
        label: 'Review booking',
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => SummaryScreen(draft: d))),
      ),
    );
  }
}

// ─────────────────────────────── Step 3: summary ───────────────────────────────

class SummaryScreen extends StatefulWidget {
  final BookingDraft draft;
  const SummaryScreen({super.key, required this.draft});
  @override
  State<SummaryScreen> createState() => _SummaryScreenState();
}

class _SummaryScreenState extends State<SummaryScreen> {
  BookingDraft get d => widget.draft;
  late Future<Quote> _quote;
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _email = TextEditingController();
  final _coupon = TextEditingController();
  bool _busy = false;
  String? _couponError;

  @override
  void initState() {
    super.initState();
    final u = context.read<AppState>().user;
    _name.text = u?['name'] ?? '';
    _phone.text = u?['phone'] ?? '';
    _email.text = u?['email'] ?? '';
    _coupon.text = d.coupon ?? '';
    _fetch();
  }

  void _fetch() => _quote = Api.instance.post('/quote', d.toBody()).then((j) => Quote.fromJson(Map<String, dynamic>.from(j)));

  Future<void> _applyCoupon() async {
    final code = _coupon.text.trim().toUpperCase();
    final prev = d.coupon;
    d.coupon = code.isEmpty ? null : code;
    try {
      final q = Quote.fromJson(Map<String, dynamic>.from(await Api.instance.post('/quote', d.toBody())));
      setState(() {
        _couponError = null;
        _quote = Future.value(q);
      });
    } catch (e) {
      d.coupon = prev;
      setState(() => _couponError = errorText(e));
    }
  }

  Future<void> _pay(Quote q) async {
    final app = context.read<AppState>();
    if (!app.loggedIn) {
      final ok = await showLoginSheet(context, reason: 'Sign in to hold ${d.space.name} and pay the advance');
      if (!ok || !mounted) return;
      final u = app.user;
      if (_name.text.isEmpty) _name.text = u?['name'] ?? '';
      if (_phone.text.isEmpty) _phone.text = u?['phone'] ?? '';
    }
    if (_name.text.trim().isEmpty || _phone.text.trim().length < 10) {
      toast(context, 'Please add a contact name and a 10-digit phone number');
      return;
    }
    setState(() => _busy = true);
    try {
      final b = Booking(Map<String, dynamic>.from(await Api.instance.post(
        '/bookings',
        {
          ...d.toBody(),
          'contact': {'name': _name.text.trim(), 'phone': _phone.text.trim(), if (_email.text.trim().isNotEmpty) 'email': _email.text.trim()},
          'notes': d.notes,
        },
        {'Idempotency-Key': d.idempotencyKey},
      )));
      if (!mounted) return;
      if (b.status == 'REQUESTED') {
        Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => RequestSentScreen(booking: b)), (r) => r.isFirst);
        return;
      }
      await startCheckout(context, b);
    } catch (e) {
      if (!mounted) return;
      if (e is ApiException && e.code == 'SLOT_UNAVAILABLE') {
        await showDialog(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Just booked by someone else'),
            content: Text(e.message),
            actions: [FilledButton(onPressed: () => Navigator.pop(c), child: const Text('Pick another slot'))],
          ),
        );
        if (mounted) Navigator.of(context).popUntil((r) => r.settings.name == 'availability' || r.isFirst);
      } else {
        toast(context, errorText(e));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: const Text('Booking summary')),
      body: FutureBuilder<Quote>(
        future: _quote,
        builder: (context, snap) {
          if (snap.hasError) return ErrorView(error: snap.error!, onRetry: () => setState(_fetch));
          if (!snap.hasData) return const LoadingView(message: 'Calculating your price…');
          final q = snap.data!;
          return ListView(padding: const EdgeInsets.only(bottom: 130), children: [
            const _StepHeader(3, 'Review & pay'),
            Panel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('YOUR EVENT', style: TextStyle(color: Brand.muted, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 0.8)),
                const SizedBox(height: 8),
                Text(app.categoryName(d.eventType), style: Theme.of(context).textTheme.titleLarge),
                Text('${dateLong(d.date)} · ${titleCase(d.slot.toLowerCase())} · ${d.guests} guests', style: const TextStyle(color: Brand.inkSoft)),
                const SizedBox(height: 10),
                Text(d.venue.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                Text('${d.space.name}${d.package != null ? ' · ${d.package!.name}' : ''}', style: const TextStyle(color: Brand.inkSoft)),
              ]),
            ),
            const SizedBox(height: 12),
            Panel(
              child: Column(children: [
                for (final l in q.lines.where((l) => l.kind != 'tax' && l.kind != 'discount'))
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 5),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(l.label.replaceFirst('Venue — ', 'Venue · ').replaceFirst('Package — ', 'Package · '), style: const TextStyle(fontWeight: FontWeight.w600)),
                          if (l.detail != null) Text(l.detail!, style: const TextStyle(color: Brand.muted, fontSize: 12)),
                        ]),
                      ),
                      Text(l.amount == 0 ? 'Included' : inr(l.amount), style: const TextStyle(fontWeight: FontWeight.w600)),
                    ]),
                  ),
                const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Divider()),
                KeyValueRow('Subtotal', inr(q.subtotal)),
                if (q.discount > 0) KeyValueRow('Coupon ${q.couponCode}', '− ${inr(q.discount)}', color: Brand.available),
                KeyValueRow('GST ${q.taxRateBps / 100}%', inr(q.tax)),
                const Padding(padding: EdgeInsets.symmetric(vertical: 8), child: Divider()),
                KeyValueRow('Total', inr(q.total), bold: true),
                KeyValueRow('Advance (${q.advancePct}%) — pay now', inr(q.advance), bold: true, color: Brand.teal),
                KeyValueRow('Remaining — pay at the venue', inr(q.balance)),
              ]),
            ),
            const SizedBox(height: 12),
            Panel(
              child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: TextField(
                    controller: _coupon,
                    textCapitalization: TextCapitalization.characters,
                    decoration: InputDecoration(labelText: 'Coupon code', hintText: 'WELCOME10', errorText: _couponError, isDense: true),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(onPressed: _applyCoupon, child: Text(q.couponCode != null ? 'Update' : 'Apply')),
              ]),
            ),
            const SizedBox(height: 12),
            Panel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Contact for this booking', style: TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 10),
                TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Full name', isDense: true)),
                const SizedBox(height: 10),
                TextField(controller: _phone, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Mobile', prefixText: '+91 ', isDense: true)),
                const SizedBox(height: 10),
                TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Email for invoice (optional)', isDense: true)),
                const SizedBox(height: 8),
                const Text('Your number is shared with the venue only through Pandal.', style: TextStyle(color: Brand.muted, fontSize: 12)),
              ]),
            ),
            const SizedBox(height: 12),
            Panel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('Cancellation policy', style: TextStyle(fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                for (final r in q.policy) KeyValueRow(r.label, r.refundPct == 0 ? 'No refund' : '${r.refundPct}% of advance'),
              ]),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 12, 20, 0),
              child: Text('Prices are calculated by Pandal\'s servers. Your slot is held for 15 minutes once you proceed.', style: TextStyle(color: Brand.muted, fontSize: 12)),
            ),
          ]);
        },
      ),
      bottomNavigationBar: FutureBuilder<Quote>(
        future: _quote,
        builder: (context, snap) => _BottomCta(
          label: snap.hasData ? (d.venue.card.bookingMode == 'request' ? 'SEND REQUEST' : 'PAY ${inr(snap.data!.advance)}') : 'PAY',
          busy: _busy,
          onPressed: snap.hasData && !_busy ? () => _pay(snap.data!) : null,
        ),
      ),
    );
  }
}

/// Ask the server for a gateway order. On web the gateway redirects back to
/// the app (with order id, payment id and signature) instead of a popup.
Future<Map<String, dynamic>> _createPayment(String bookingId, String purpose) async {
  final returnUrl = kIsWeb ? '${Uri.base.origin}${Uri.base.path}?pay_return=1&booking_id=$bookingId&purpose=$purpose' : null;
  return Map<String, dynamic>.from(await Api.instance.post('/bookings/$bookingId/pay', {'purpose': purpose, if (returnUrl != null) 'return_url': returnUrl}));
}

Future<void> _openCheckout(Map<String, dynamic> pay) =>
    launchUrl(Uri.parse(pay['checkout_url']), mode: LaunchMode.inAppBrowserView, webOnlyWindowName: kIsWeb ? '_self' : null);

/// Start (or restart) checkout for a booking: server creates the gateway
/// order, we open the hosted checkout, then wait for server verification.
Future<void> startCheckout(BuildContext context, Booking b, {String purpose = 'advance'}) async {
  final pay = await _createPayment(b.id, purpose);
  if (!context.mounted) return;
  await _openCheckout(pay);
  // Web: the page navigates to the gateway and comes back via PaymentReturnScreen.
  if (kIsWeb || !context.mounted) return;
  await Navigator.of(context).push(MaterialPageRoute(builder: (_) => PaymentScreen(booking: b, payment: pay)));
}

/// Web: the gateway redirected back with ?order_id&payment_id&signature.
/// The server verifies the signature and re-fetches the order before confirming.
class PaymentReturnScreen extends StatefulWidget {
  final Map<String, String> params;
  const PaymentReturnScreen({super.key, required this.params});
  @override
  State<PaymentReturnScreen> createState() => _PaymentReturnScreenState();
}

class _PaymentReturnScreenState extends State<PaymentReturnScreen> {
  String _state = 'verifying'; // verifying | failed | pending | refunded | error
  String? _message;
  Booking? _booking;

  @override
  void initState() {
    super.initState();
    _verify();
  }

  Future<void> _verify({int attempt = 0}) async {
    final p = widget.params;
    try {
      final r = await Api.instance.post('/payments/verify', {
        'order_id': p['order_id'],
        if (p['payment_id'] != null && p['status'] == 'paid') 'payment_id': p['payment_id'],
        if (p['signature'] != null && p['status'] == 'paid') 'signature': p['signature'],
      });
      final b = Booking(Map<String, dynamic>.from(r['booking']));
      if (!mounted) return;
      _booking = b;
      switch (r['outcome']) {
        case 'captured':
          Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ConfirmationScreen(booking: b)));
        case 'failed':
          setState(() {
            _state = 'failed';
            _message = 'The payment did not go through. No money was taken.';
          });
        case 'refunded':
          setState(() {
            _state = 'refunded';
            _message = 'Your payment arrived after the slot was released, so it has been fully refunded.';
          });
        default:
          if (attempt < 10) {
            await Future.delayed(const Duration(seconds: 2));
            if (mounted) _verify(attempt: attempt + 1);
          } else {
            setState(() {
              _state = 'pending';
              _message = 'We are still waiting for the gateway to confirm. Check My Events in a minute.';
            });
          }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _state = 'error';
          _message = errorText(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Payment')),
        body: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(children: [
            const Spacer(),
            if (_state == 'verifying') ...[
              const SizedBox(width: 56, height: 56, child: CircularProgressIndicator(strokeWidth: 4, color: Brand.teal)),
              const SizedBox(height: 24),
              Text('Verifying your payment', style: Theme.of(context).textTheme.headlineSmall),
              const SizedBox(height: 8),
              const Text('Pandal is confirming the payment with the gateway. This takes a few seconds.', textAlign: TextAlign.center, style: TextStyle(color: Brand.inkSoft)),
            ] else ...[
              Icon(_state == 'failed' || _state == 'error' ? Icons.error_rounded : Icons.hourglass_top_rounded, size: 64, color: _state == 'failed' || _state == 'error' ? Brand.danger : Brand.marigold),
              const SizedBox(height: 16),
              Text(
                switch (_state) { 'failed' => 'Payment failed', 'refunded' => 'Payment refunded', 'pending' => 'Payment pending', _ => 'Could not verify' },
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 8),
              Text(_message ?? '', textAlign: TextAlign.center, style: const TextStyle(color: Brand.inkSoft)),
            ],
            const Spacer(),
            if (_state == 'failed' && _booking != null && _booking!.awaitingPayment)
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () async {
                    try {
                      await startCheckout(context, _booking!, purpose: widget.params['purpose'] ?? 'advance');
                    } catch (e) {
                      if (context.mounted) toast(context, errorText(e));
                    }
                  },
                  child: const Text('Try payment again'),
                ),
              ),
            if (widget.params['booking_id'] != null && _state != 'verifying')
              TextButton(
                onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: widget.params['booking_id']!))),
                child: const Text('View booking'),
              ),
          ]),
        ),
      );
}

// ─────────────────────────────── Payment verification ───────────────────────────────

class PaymentScreen extends StatefulWidget {
  final Booking booking;
  final Map<String, dynamic> payment;
  const PaymentScreen({super.key, required this.booking, required this.payment});
  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> with WidgetsBindingObserver {
  Timer? _poll;
  Timer? _tick;
  String _state = 'waiting'; // waiting | failed | refunded
  String? _message;
  late Map<String, dynamic> _payment = widget.payment;
  bool _checking = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _poll = Timer.periodic(const Duration(milliseconds: 2500), (_) => _check());
    _tick = Timer.periodic(const Duration(seconds: 1), (_) => mounted ? setState(() {}) : null);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _poll?.cancel();
    _tick?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    if (s == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    if (_checking || _state != 'waiting') return;
    _checking = true;
    try {
      final r = await Api.instance.post('/payments/verify', {'order_id': _payment['order_id']});
      final outcome = r['outcome'];
      final b = Booking(Map<String, dynamic>.from(r['booking']));
      if (!mounted) return;
      if (outcome == 'captured') {
        _poll?.cancel();
        if (b.status == 'CONFIRMED' || b.status == 'UPCOMING' || _payment['purpose'] == 'balance') {
          Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => ConfirmationScreen(booking: b)), (r) => r.isFirst);
        }
      } else if (outcome == 'failed') {
        setState(() {
          _state = 'failed';
          _message = 'The payment did not go through. No money was taken.';
        });
      } else if (outcome == 'refunded') {
        _poll?.cancel();
        setState(() {
          _state = 'refunded';
          _message = 'Your payment arrived after the slot was released, so it has been fully refunded.';
        });
      }
    } catch (_) {
      // transient; keep polling
    } finally {
      _checking = false;
    }
  }

  Future<void> _retry() async {
    try {
      final pay = await _createPayment(widget.booking.id, _payment['purpose'] ?? 'advance');
      setState(() {
        _payment = pay;
        _state = 'waiting';
        _message = null;
      });
      await _openCheckout(pay);
    } catch (e) {
      if (mounted) toast(context, errorText(e));
    }
  }

  String? get _remaining {
    final exp = DateTime.tryParse(_payment['hold_expires_at'] ?? '');
    if (exp == null) return null;
    final left = exp.difference(DateTime.now());
    if (left.isNegative) return '0:00';
    return '${left.inMinutes}:${(left.inSeconds % 60).toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final remaining = _remaining;
    return Scaffold(
      appBar: AppBar(title: const Text('Payment')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(children: [
          const Spacer(),
          if (_state == 'waiting') ...[
            const SizedBox(width: 56, height: 56, child: CircularProgressIndicator(strokeWidth: 4, color: Brand.teal)),
            const SizedBox(height: 24),
            Text('Complete your payment', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text('Pay ${inr(_payment['amount'])} in the secure payment window. We confirm your booking only after verifying the payment with the gateway.',
                textAlign: TextAlign.center, style: const TextStyle(color: Brand.inkSoft, height: 1.4)),
            if (remaining != null && _payment['purpose'] != 'balance') ...[
              const SizedBox(height: 18),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(color: Brand.marigoldSoft, borderRadius: BorderRadius.circular(20)),
                child: Text('Slot held for $remaining', style: const TextStyle(color: Color(0xFFA86400), fontWeight: FontWeight.w800)),
              ),
            ],
          ] else ...[
            Icon(_state == 'failed' ? Icons.error_rounded : Icons.replay_circle_filled_rounded, size: 64, color: _state == 'failed' ? Brand.danger : Brand.marigold),
            const SizedBox(height: 16),
            Text(_state == 'failed' ? 'Payment failed' : 'Payment refunded', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: 8),
            Text(_message ?? '', textAlign: TextAlign.center, style: const TextStyle(color: Brand.inkSoft)),
          ],
          const Spacer(),
          if (_state == 'waiting')
            OutlinedButton.icon(
              onPressed: () => _openCheckout(_payment),
              icon: const Icon(Icons.open_in_new_rounded),
              label: const Text('Open payment page again'),
            ),
          if (_state == 'failed')
            SizedBox(width: double.infinity, child: FilledButton(onPressed: _retry, child: const Text('Try payment again'))),
          const SizedBox(height: 8),
          TextButton(
            onPressed: () => Navigator.of(context).pushAndRemoveUntil(MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: widget.booking.id)), (r) => r.isFirst),
            child: const Text('View booking'),
          ),
        ]),
      ),
    );
  }
}

// ─────────────────────────────── Confirmation ───────────────────────────────

String invoiceUrl(String bookingId) => '${AppConfig.apiBase}/api/v1/bookings/$bookingId/invoice?token=${Api.instance.token}';

class ConfirmationScreen extends StatefulWidget {
  final Booking booking;
  const ConfirmationScreen({super.key, required this.booking});
  @override
  State<ConfirmationScreen> createState() => _ConfirmationScreenState();
}

class _ConfirmationScreenState extends State<ConfirmationScreen> with SingleTickerProviderStateMixin {
  late final _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 700))..forward();

  @override
  void dispose() {
    _anim.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final b = widget.booking;
    final app = context.read<AppState>();
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 24),
          Center(
            child: ScaleTransition(
              scale: CurvedAnimation(parent: _anim, curve: Curves.elasticOut),
              child: Container(
                width: 104,
                height: 104,
                decoration: const BoxDecoration(color: Brand.available, shape: BoxShape.circle),
                child: const Icon(Icons.check_rounded, color: Colors.white, size: 64),
              ),
            ),
          ),
          const SizedBox(height: 22),
          Text('Booking Confirmed', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 22),
          Panel(
            margin: EdgeInsets.zero,
            child: Column(children: [
              Text(b.venueName, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 4),
              Text('${app.categoryName(b.eventType)} · ${b.spaceName}', style: const TextStyle(color: Brand.inkSoft)),
              const SizedBox(height: 4),
              Text('${dateLong(b.eventDate)} · ${b.slotTime}', style: const TextStyle(fontWeight: FontWeight.w700)),
              const Padding(padding: EdgeInsets.symmetric(vertical: 14), child: Divider()),
              KeyValueRow('Paid', inr(b.paid), bold: true, color: Brand.available),
              KeyValueRow('Remaining at venue', inr(b.balance)),
              const SizedBox(height: 10),
              const Text('Booking ID', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
              SelectableText(b.code, style: const TextStyle(fontWeight: FontWeight.w900, fontSize: 20, letterSpacing: 0.5)),
            ]),
          ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: b.id))),
            child: const Text('View Booking'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: () => launchUrl(Uri.parse(invoiceUrl(b.id)), mode: LaunchMode.externalApplication),
            icon: const Icon(Icons.receipt_long_rounded),
            label: const Text('Download Invoice'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(onPressed: () => openDirections(b.venueLat, b.venueLng), icon: const Icon(Icons.directions_rounded), label: const Text('Get Directions')),
          const SizedBox(height: 10),
          TextButton(
            onPressed: () {
              Navigator.of(context).popUntil((r) => r.isFirst);
              Shell.goTo(2);
            },
            child: const Text('Go to My Events'),
          ),
        ]),
      ),
    );
  }
}

class RequestSentScreen extends StatelessWidget {
  final Booking booking;
  const RequestSentScreen({super.key, required this.booking});
  @override
  Widget build(BuildContext context) => Scaffold(
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(children: [
              const Spacer(),
              const Icon(Icons.mark_email_read_rounded, size: 80, color: Brand.marigold),
              const SizedBox(height: 18),
              Text('Request sent', style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Text('${booking.venueName} will respond within 24 hours. Your slot is held meanwhile — once they accept, you\'ll have 24 hours to pay the advance.',
                  textAlign: TextAlign.center, style: const TextStyle(color: Brand.inkSoft, height: 1.4)),
              const SizedBox(height: 12),
              Text(booking.code, style: const TextStyle(fontWeight: FontWeight.w900)),
              const Spacer(),
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => BookingDetailScreen(bookingId: booking.id))),
                  child: const Text('View request'),
                ),
              ),
            ]),
          ),
        ),
      );
}

class _BottomCta extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool busy;
  const _BottomCta({required this.label, required this.onPressed, this.busy = false});
  @override
  Widget build(BuildContext context) => SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.line))),
          child: FilledButton(
            onPressed: onPressed,
            child: busy ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)) : Text(label),
          ),
        ),
      );
}
