import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../state/app_state.dart';

/// Bottom-sheet filters: Location · Event · Date · Guests · Budget · Venue type · Facilities.
Future<SearchQuery?> showFiltersSheet(BuildContext context, SearchQuery current) {
  return showModalBottomSheet<SearchQuery>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => _FiltersSheet(initial: current),
  );
}

class _FiltersSheet extends StatefulWidget {
  final SearchQuery initial;
  const _FiltersSheet({required this.initial});
  @override
  State<_FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends State<_FiltersSheet> {
  late SearchQuery q = widget.initial.copy();

  static const _radius = [1, 5, 10, 25, 50];
  static const _guestBuckets = [(1, '<100'), (100, '100–250'), (250, '250–500'), (500, '500–1000'), (1000, '1000+')];
  static const _budgets = [25000, 50000, 100000, 200000];

  String _weekday(DateTime d) => isoDate(d);

  void _setDate(String? label) {
    final now = DateTime.now();
    setState(() {
      q.dateLabel = label;
      q.date = null;
      q.dateFrom = null;
      q.dateTo = null;
      switch (label) {
        case 'Today':
          q.date = _weekday(now);
        case 'Tomorrow':
          q.date = _weekday(now.add(const Duration(days: 1)));
        case 'This weekend':
          final wd = now.weekday; // 1 Mon … 7 Sun
          final sat = wd == 7 ? now.subtract(const Duration(days: 1)) : now.add(Duration(days: 6 - wd));
          q.dateFrom = _weekday(sat.isBefore(now) ? now : sat);
          q.dateTo = _weekday(sat.add(const Duration(days: 1)));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    Widget section(String title, Widget child) => Padding(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 10),
            child,
          ]),
        );
    Widget chip(String label, bool selected, VoidCallback onTap) =>
        ChoiceChip(label: Text(label), selected: selected, onSelected: (_) => onTap(), showCheckmark: false, selectedColor: Brand.tealSoft);

    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.88,
      maxChildSize: 0.95,
      builder: (context, scroll) => Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 8, 0),
          child: Row(children: [
            Text('Filters', style: Theme.of(context).textTheme.headlineSmall),
            const Spacer(),
            TextButton(
              onPressed: () => setState(() {
                q = SearchQuery(q: widget.initial.q)..sort = widget.initial.sort;
              }),
              child: const Text('Clear all'),
            ),
          ]),
        ),
        Expanded(
          child: ListView(controller: scroll, padding: const EdgeInsets.only(bottom: 24), children: [
            section(
              'Location',
              Wrap(spacing: 8, runSpacing: 8, children: [
                chip('Near me', q.radiusKm == null, () => setState(() => q.radiusKm = null)),
                for (final r in _radius) chip('$r km', q.radiusKm == r, () => setState(() => q.radiusKm = r)),
              ]),
            ),
            section(
              'Event',
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final c in app.categories)
                  chip(c.name, q.event == c.code, () => setState(() => q.event = q.event == c.code ? null : c.code)),
              ]),
            ),
            section(
              'Date',
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final l in ['Today', 'Tomorrow', 'This weekend']) chip(l, q.dateLabel == l, () => _setDate(q.dateLabel == l ? null : l)),
                ActionChip(
                  avatar: const Icon(Icons.calendar_month_rounded, size: 18),
                  label: Text(q.date != null && !['Today', 'Tomorrow'].contains(q.dateLabel) ? dateLong(q.date) : 'Select date'),
                  backgroundColor: q.date != null && !['Today', 'Tomorrow'].contains(q.dateLabel) ? Brand.tealSoft : null,
                  onPressed: () async {
                    final now = DateTime.now();
                    final d = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 540)), initialDate: parseDate(q.date) ?? now);
                    if (d == null) return;
                    setState(() {
                      q.date = isoDate(d);
                      q.dateFrom = null;
                      q.dateTo = null;
                      q.dateLabel = dateShort(q.date);
                    });
                  },
                ),
              ]),
            ),
            section(
              'Guests',
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final (min, label) in _guestBuckets)
                  chip(label, q.guestsLabel == label, () => setState(() {
                        final on = q.guestsLabel != label;
                        q.guestsLabel = on ? label : null;
                        q.guests = on ? min : null;
                      })),
              ]),
            ),
            section(
              'Budget (starting venue price)',
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final b in _budgets) chip('Up to ${inrShort(b)}', q.budgetMax == b, () => setState(() => q.budgetMax = q.budgetMax == b ? null : b)),
                chip('₹5L+', q.budgetMax == null, () => setState(() => q.budgetMax = null)),
              ]),
            ),
            section(
              'Venue type',
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final t in app.venueTypes)
                  FilterChip(
                    label: Text(t.name),
                    selected: q.venueTypes.contains(t.code),
                    selectedColor: Brand.tealSoft,
                    onSelected: (on) => setState(() => on ? q.venueTypes.add(t.code) : q.venueTypes.remove(t.code)),
                  ),
              ]),
            ),
            section(
              'Facilities',
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final f in app.facilities)
                  FilterChip(
                    avatar: Icon(facilityIcon(f.code), size: 16),
                    label: Text(f.name),
                    selected: q.facilities.contains(f.code),
                    selectedColor: Brand.tealSoft,
                    onSelected: (on) => setState(() => on ? q.facilities.add(f.code) : q.facilities.remove(f.code)),
                  ),
              ]),
            ),
          ]),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
            child: SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(context, q), child: const Text('Show venues'))),
          ),
        ),
      ]),
    );
  }
}
