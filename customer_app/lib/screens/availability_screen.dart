import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import 'booking_flow.dart';
import 'venue_screen.dart';

/// Check availability → select date → select space & slot.
class AvailabilityScreen extends StatefulWidget {
  final VenueDetail venue;
  final SearchQuery? query;
  const AvailabilityScreen({super.key, required this.venue, this.query});
  @override
  State<AvailabilityScreen> createState() => _AvailabilityScreenState();
}

class _AvailabilityScreenState extends State<AvailabilityScreen> {
  late DateTime _month;
  String? _date;
  late String _event;
  late int _guests;
  Future<Map<String, dynamic>>? _monthFuture;
  Future<Map<String, dynamic>>? _dayFuture;
  String? _spaceId;
  String? _slot;

  @override
  void initState() {
    super.initState();
    final q = widget.query;
    final v = widget.venue;
    _event = (q?.event != null && v.card.eventTypes.contains(q!.event)) ? q.event! : (v.card.eventTypes.isNotEmpty ? v.card.eventTypes.first : 'other');
    final minGuests = v.spaces.isEmpty ? 50 : v.spaces.map((s) => s.minGuests).reduce((a, b) => a < b ? a : b);
    _guests = (q?.guests != null && q!.guests! > 1) ? q.guests! : (minGuests > 0 ? minGuests : 100).clamp(1, v.card.capacityMax ?? 100000);
    final start = parseDate(q?.date ?? q?.dateFrom) ?? DateTime.now();
    _month = DateTime(start.year, start.month);
    if (q?.date != null) _date = q!.date;
    _loadMonth();
    if (_date != null) _loadDay();
  }

  String get _monthKey => '${_month.year}-${_month.month.toString().padLeft(2, '0')}';

  void _loadMonth() {
    _monthFuture = Api.instance.get('/venues/${widget.venue.id}/availability', {'month': _monthKey, 'guests': _guests}).then((r) => Map<String, dynamic>.from(r));
  }

  void _loadDay() {
    _spaceId = null;
    _slot = null;
    _dayFuture = Api.instance.get('/venues/${widget.venue.id}/availability/$_date', {'guests': _guests}).then((r) => Map<String, dynamic>.from(r));
  }

  void _changeGuests(int delta) {
    final max = widget.venue.card.capacityMax ?? 5000;
    final next = (_guests + delta).clamp(10, max);
    if (next == _guests) return;
    setState(() {
      _guests = next;
      _loadMonth();
      if (_date != null) _loadDay();
    });
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final v = widget.venue;
    final now = DateTime.now();
    final canPrev = DateTime(_month.year, _month.month).isAfter(DateTime(now.year, now.month));
    return Scaffold(
      appBar: AppBar(title: Text('Check availability', style: Theme.of(context).appBarTheme.titleTextStyle), bottom: PreferredSize(preferredSize: const Size.fromHeight(20), child: Padding(padding: const EdgeInsets.only(left: 16, bottom: 8), child: Align(alignment: Alignment.centerLeft, child: Text(v.name, style: const TextStyle(color: Brand.inkSoft)))))),
      body: ListView(padding: const EdgeInsets.only(bottom: 120), children: [
        // What is the event? + Guests
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('What is the event?', style: TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 8),
            SizedBox(
              height: 40,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final e in v.card.eventTypes)
                  Padding(
                    padding: const EdgeInsets.only(right: 8),
                    child: ChoiceChip(
                      avatar: Icon(categoryIcon(e), size: 16),
                      label: Text(app.categoryName(e)),
                      selected: _event == e,
                      showCheckmark: false,
                      onSelected: (_) => setState(() => _event = e),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: 14),
            Row(children: [
              const Expanded(child: Text('Guests', style: TextStyle(fontWeight: FontWeight.w800))),
              _StepButton(icon: Icons.remove_rounded, onTap: () => _changeGuests(_guests > 100 ? -50 : -10)),
              SizedBox(width: 72, child: Text('$_guests', textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900))),
              _StepButton(icon: Icons.add_rounded, onTap: () => _changeGuests(_guests >= 100 ? 50 : 10)),
            ]),
            Text('Up to ${v.card.capacityMax} guests across ${v.spaces.length} space${v.spaces.length == 1 ? '' : 's'}', style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
          ]),
        ),
        const SizedBox(height: 16),
        Panel(
          child: Column(children: [
            Row(children: [
              IconButton(onPressed: canPrev ? () => setState(() {
                    _month = DateTime(_month.year, _month.month - 1);
                    _loadMonth();
                  }) : null, icon: const Icon(Icons.chevron_left_rounded)),
              Expanded(child: Text(_monthName(_month), textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium)),
              IconButton(onPressed: () => setState(() {
                    _month = DateTime(_month.year, _month.month + 1);
                    _loadMonth();
                  }), icon: const Icon(Icons.chevron_right_rounded)),
            ]),
            const SizedBox(height: 6),
            Row(children: [
              for (final d in ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
                Expanded(child: Text(d, textAlign: TextAlign.center, style: const TextStyle(color: Brand.muted, fontWeight: FontWeight.w700, fontSize: 12))),
            ]),
            const SizedBox(height: 6),
            FutureBuilder<Map<String, dynamic>>(
              future: _monthFuture,
              builder: (context, snap) {
                if (snap.hasError) return SizedBox(height: 240, child: ErrorView(error: snap.error!, onRetry: () => setState(_loadMonth)));
                if (!snap.hasData) return const SizedBox(height: 240, child: LoadingView());
                final days = List<Map<String, dynamic>>.from(snap.data!['days']);
                final lead = DateTime(_month.year, _month.month, 1).weekday - 1;
                final cells = <Widget>[for (var i = 0; i < lead; i++) const SizedBox()];
                for (final d in days) {
                  final st = d['status'] as String;
                  final selectable = st == 'available' || st == 'limited';
                  final selected = d['date'] == _date;
                  final day = int.parse((d['date'] as String).substring(8));
                  cells.add(Padding(
                    padding: const EdgeInsets.all(3),
                    child: Material(
                      color: selected ? Brand.teal : (selectable ? Brand.statusColor(st).withValues(alpha: 0.10) : Colors.transparent),
                      borderRadius: BorderRadius.circular(12),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: st == 'unavailable' && d['reason'] == 'past'
                            ? null
                            : () => setState(() {
                                  _date = d['date'];
                                  _loadDay();
                                }),
                        child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                          Text('$day', style: TextStyle(fontWeight: FontWeight.w800, color: selected ? Colors.white : (st == 'unavailable' ? Brand.unavailable : Brand.ink), decoration: st == 'booked' ? TextDecoration.lineThrough : null)),
                          const SizedBox(height: 3),
                          AvailabilityDot(st, size: 6),
                        ]),
                      ),
                    ),
                  ));
                }
                return GridView.count(crossAxisCount: 7, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), childAspectRatio: 0.95, children: cells);
              },
            ),
            const SizedBox(height: 10),
            const AvailabilityLegend(),
          ]),
        ),
        if (_date != null) ...[
          SectionHeader(dateWithDay(_date), subtitle: 'Choose a space and time'),
          FutureBuilder<Map<String, dynamic>>(
            future: _dayFuture,
            builder: (context, snap) {
              if (snap.hasError) return ErrorView(error: snap.error!, onRetry: () => setState(_loadDay));
              if (!snap.hasData) return const SizedBox(height: 120, child: LoadingView());
              final spaces = List<Map<String, dynamic>>.from(snap.data!['spaces']);
              return Column(children: [
                for (final s in spaces)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Panel(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Row(children: [
                          Expanded(child: Text(s['name'], style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                          Text('Capacity ${s['capacity_floating']}', style: TextStyle(color: s['fits_guests'] == true ? Brand.inkSoft : Brand.danger, fontWeight: FontWeight.w600, fontSize: 13)),
                        ]),
                        if (s['fits_guests'] != true)
                          Padding(padding: const EdgeInsets.only(top: 4), child: Text("Doesn't fit $_guests guests", style: const TextStyle(color: Brand.danger, fontSize: 12.5))),
                        const SizedBox(height: 10),
                        for (final sl in List<Map<String, dynamic>>.from(s['slots']))
                          _SlotRow(
                            slot: sl,
                            price: widget.venue.spaces.firstWhere((x) => x.id == s['space_id']).prices[sl['slot']],
                            selected: _spaceId == s['space_id'] && _slot == sl['slot'],
                            onTap: sl['status'] == 'available' ? () => setState(() {
                                  _spaceId = s['space_id'];
                                  _slot = sl['slot'];
                                }) : null,
                          ),
                      ]),
                    ),
                  ),
              ]);
            },
          ),
        ],
      ]),
      bottomNavigationBar: SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.line))),
          child: FilledButton(
            onPressed: _spaceId == null
                ? null
                : () {
                    final draft = BookingDraft(venue: v, eventType: _event, date: _date!, slot: _slot!, guests: _guests, spaceId: _spaceId!);
                    Navigator.of(context).push(MaterialPageRoute(builder: (_) => PackageScreen(draft: draft))).then((_) {
                      // Inventory may have changed while the customer was in checkout.
                      if (mounted) {
                        setState(() {
                          _loadMonth();
                          _loadDay();
                        });
                      }
                    });
                  },
            child: Text(_spaceId == null
                ? (_date == null ? 'Select a date' : 'Select a space & time')
                : 'Continue · ${v.spaces.firstWhere((s) => s.id == _spaceId).name}, ${titleCase(_slot!.toLowerCase())}'),
          ),
        ),
      ),
    );
  }

  static String _monthName(DateTime m) => '${const ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m.month - 1]} ${m.year}';
}

class _SlotRow extends StatelessWidget {
  final Map<String, dynamic> slot;
  final int? price;
  final bool selected;
  final VoidCallback? onTap;
  const _SlotRow({required this.slot, required this.price, required this.selected, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final st = slot['status'] as String;
    final reason = slot['reason'];
    final label = switch (st) {
      'available' => 'Available',
      'booked' => reason == 'on_hold' ? 'On hold' : 'Booked',
      _ => reason == 'capacity' ? 'Too small' : reason == 'past' ? 'Past' : 'Unavailable',
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: selected ? Brand.tealSoft : Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: selected ? Brand.teal : Brand.line, width: selected ? 1.6 : 1)),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(children: [
              Icon(selected ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded, color: onTap == null ? Brand.unavailable : Brand.teal, size: 20),
              const SizedBox(width: 10),
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(slot['label'], style: TextStyle(fontWeight: FontWeight.w700, color: onTap == null ? Brand.muted : Brand.ink)),
                  Text(slot['time'], style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
                ]),
              ),
              if (price != null && onTap != null) Padding(padding: const EdgeInsets.only(right: 10), child: Text(inr(price), style: const TextStyle(fontWeight: FontWeight.w700))),
              AvailabilityDot(st == 'available' ? 'available' : st == 'booked' ? 'booked' : 'unavailable'),
              const SizedBox(width: 5),
              Text(label, style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.statusColor(st == 'available' ? 'available' : st == 'booked' ? 'booked' : 'unavailable'))),
            ]),
          ),
        ),
      ),
    );
  }
}

class _StepButton extends StatelessWidget {
  final IconData icon;
  final VoidCallback onTap;
  const _StepButton({required this.icon, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        shape: const CircleBorder(side: BorderSide(color: Brand.line)),
        child: InkWell(customBorder: const CircleBorder(), onTap: onTap, child: Padding(padding: const EdgeInsets.all(8), child: Icon(icon, color: Brand.teal))),
      );
}
