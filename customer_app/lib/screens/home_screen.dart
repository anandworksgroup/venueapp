import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import '../widgets/venue_card.dart';
import 'location_screens.dart';
import 'results_screen.dart';
import 'search_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Future<List<Map<String, dynamic>>>? _rails;
  PlaceLocation? _loadedFor;

  void _load(PlaceLocation? loc) {
    _loadedFor = loc;
    _rails = Api.instance.get('/discover/rails', {
      if (loc != null) 'lat': loc.lat,
      if (loc != null) 'lng': loc.lng,
      if (loc != null) 'location_label': loc.shortLabel,
    }).then((r) => List<Map<String, dynamic>>.from(r['rails']));
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    if (_rails == null || !identical(_loadedFor, app.location)) _load(app.location);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: Brand.teal,
          onRefresh: () async {
            setState(() => _load(app.location));
            await _rails;
          },
          child: CustomScrollView(slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Row(children: const [Expanded(child: LocationBar()), Wordmark(size: 22)]),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 18, 20, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Text('Hi${app.firstName != null ? ' ${app.firstName}' : ''}', style: const TextStyle(color: Brand.inkSoft, fontSize: 16, fontWeight: FontWeight.w600)),
                    const SizedBox(width: 6),
                    const Icon(Icons.waving_hand_rounded, size: 18, color: Brand.marigold),
                  ]),
                  const SizedBox(height: 2),
                  Text('What are you planning?', style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 16),
                  const SearchBarButton(),
                ]),
              ),
            ),
            const SliverToBoxAdapter(child: SectionHeader('Categories')),
            SliverToBoxAdapter(child: _CategoryStrip(categories: app.categories)),
            const SliverToBoxAdapter(child: SizedBox(height: 8)),
            const SliverToBoxAdapter(child: _PlannerCard()),
            SliverToBoxAdapter(
              child: FutureBuilder<List<Map<String, dynamic>>>(
                future: _rails,
                builder: (context, snap) {
                  if (snap.hasError) return SizedBox(height: 260, child: ErrorView(error: snap.error!, onRetry: () => setState(() => _load(app.location))));
                  if (!snap.hasData) return const SizedBox(height: 260, child: LoadingView());
                  final rails = snap.data!;
                  return Column(children: [for (final r in rails.take(5)) VenueRail(rail: r)]);
                },
              ),
            ),
            const SliverToBoxAdapter(child: SizedBox(height: 32)),
          ]),
        ),
      ),
    );
  }
}

/// Tappable search field that opens the search screen.
class SearchBarButton extends StatelessWidget {
  final String hint;
  const SearchBarButton({super.key, this.hint = 'Search venues, areas or services'});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        elevation: 0,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SearchScreen())),
          child: Container(
            height: 54,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Brand.line),
              boxShadow: const [BoxShadow(color: Color(0x0F000000), blurRadius: 14, offset: Offset(0, 4))],
            ),
            child: Row(children: [
              const Icon(Icons.search_rounded, color: Brand.teal),
              const SizedBox(width: 10),
              Expanded(child: Text(hint, style: const TextStyle(color: Brand.muted, fontSize: 15))),
              Container(width: 1, height: 22, color: Brand.line),
              const SizedBox(width: 10),
              const Icon(Icons.mic_none_rounded, color: Brand.muted),
            ]),
          ),
        ),
      );
}

class _CategoryStrip extends StatelessWidget {
  final List<Category> categories;
  const _CategoryStrip({required this.categories});

  static const _tints = [0xFFFFE9E4, 0xFFE4F2EF, 0xFFFFF1DB, 0xFFEDE7F9, 0xFFE3EEFB, 0xFFFBE7F1, 0xFFE9F4E1];

  @override
  Widget build(BuildContext context) {
    if (categories.isEmpty) return const SizedBox(height: 96);
    return SizedBox(
      height: 100,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        scrollDirection: Axis.horizontal,
        itemCount: categories.length,
        separatorBuilder: (_, __) => const SizedBox(width: 12),
        itemBuilder: (context, i) {
          final c = categories[i];
          return InkWell(
            borderRadius: BorderRadius.circular(16),
            onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ResultsScreen(query: SearchQuery(event: c.code)))),
            child: SizedBox(
              width: 76,
              child: Column(children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: BoxDecoration(color: Color(_tints[i % _tints.length]), borderRadius: BorderRadius.circular(20)),
                  child: Icon(categoryIcon(c.code), color: Brand.ink, size: 30),
                ),
                const SizedBox(height: 6),
                Text(c.name.replaceAll(' Event', ''), maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600)),
              ]),
            ),
          );
        },
      ),
    );
  }
}

/// Where + What + When + How many + Budget → SEARCH
class _PlannerCard extends StatefulWidget {
  const _PlannerCard();
  @override
  State<_PlannerCard> createState() => _PlannerCardState();
}

class _PlannerCardState extends State<_PlannerCard> {
  String? _event;
  DateTime? _date;
  int? _guests;
  int? _budget;

  static const _guestOptions = [50, 100, 200, 300, 500, 800, 1000];
  static const _budgetOptions = [25000, 50000, 100000, 200000, 500000];

  Future<T?> _pick<T>(String title, List<(T, String)> options, T? current) => showModalBottomSheet<T>(
        context: context,
        builder: (c) => SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: Theme.of(c).textTheme.titleLarge),
              const SizedBox(height: 14),
              Wrap(spacing: 8, runSpacing: 8, children: [
                for (final (v, label) in options)
                  ChoiceChip(label: Text(label), selected: v == current, onSelected: (_) => Navigator.pop(c, v)),
              ]),
            ]),
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final loc = app.location;
    Widget row(IconData icon, String label, String value, VoidCallback onTap, {bool set = false}) => InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 11),
            child: Row(children: [
              Icon(icon, size: 22, color: set ? Brand.teal : Brand.muted),
              const SizedBox(width: 12),
              SizedBox(width: 64, child: Text(label, style: const TextStyle(color: Brand.inkSoft, fontWeight: FontWeight.w600))),
              Expanded(child: Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w800, color: set ? Brand.ink : Brand.muted))),
              const Icon(Icons.chevron_right_rounded, color: Brand.muted),
            ]),
          ),
        );
    return Panel(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.auto_awesome_rounded, color: Brand.marigold, size: 20),
          const SizedBox(width: 8),
          Text('Plan your event', style: Theme.of(context).textTheme.titleMedium),
        ]),
        const SizedBox(height: 6),
        row(Icons.place_outlined, 'Where', loc?.shortLabel ?? 'Choose location', () async {
          final p = await Navigator.of(context).push<PlaceLocation>(MaterialPageRoute(builder: (_) => const LocationPickerScreen()));
          if (p != null && context.mounted) context.read<AppState>().setLocation(p);
        }, set: loc != null),
        const Divider(),
        row(Icons.celebration_outlined, 'What', _event == null ? 'Wedding, birthday…' : app.categoryName(_event), () async {
          final v = await _pick<String>('What is the event?', [for (final c in app.categories) (c.code, c.name)], _event);
          if (v != null) setState(() => _event = v);
        }, set: _event != null),
        const Divider(),
        row(Icons.calendar_month_outlined, 'When', _date == null ? 'Pick a date' : dateLong(isoDate(_date!)), () async {
          final now = DateTime.now();
          final d = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 540)), initialDate: _date ?? now.add(const Duration(days: 7)));
          if (d != null) setState(() => _date = d);
        }, set: _date != null),
        const Divider(),
        row(Icons.groups_outlined, 'Guests', _guests == null ? 'How many people?' : '$_guests guests', () async {
          final v = await _pick<int>('How many guests?', [for (final g in _guestOptions) (g, g == 1000 ? '1000+' : '$g')], _guests);
          if (v != null) setState(() => _guests = v);
        }, set: _guests != null),
        const Divider(),
        row(Icons.currency_rupee_rounded, 'Budget', _budget == null ? 'Any budget' : 'Up to ${inrShort(_budget)}', () async {
          final v = await _pick<int>('Venue budget', [for (final b in _budgetOptions) (b, b == 500000 ? '₹5L+' : 'Up to ${inrShort(b)}')], _budget);
          if (v != null) setState(() => _budget = v == 500000 ? null : v);
        }, set: _budget != null),
        const SizedBox(height: 14),
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            icon: const Icon(Icons.search_rounded),
            label: const Text('SEARCH'),
            onPressed: () {
              final q = SearchQuery(event: _event, guests: _guests, budgetMax: _budget, radiusKm: loc?.radiusKm ?? 10);
              if (_date != null) {
                q.date = isoDate(_date!);
                q.dateLabel = dateShort(q.date);
              }
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => ResultsScreen(query: q)));
            },
          ),
        ),
      ]),
    );
  }
}

/// A titled horizontal list of venue cards.
class VenueRail extends StatelessWidget {
  final Map<String, dynamic> rail;
  const VenueRail({super.key, required this.rail});

  SearchQuery _queryFor(String key, String today) {
    final q = SearchQuery();
    switch (key) {
      case 'near_you':
        q.radiusKm = 25;
        q.sort = 'distance';
      case 'popular':
        q.sort = 'reviews';
      case 'weekend':
        q.dateLabel = 'This weekend';
        q.q = 'this weekend';
      case 'wedding':
        q.event = 'wedding';
        q.guests = 300;
      case 'budget':
        q.budgetMax = 60000;
        q.sort = 'price_asc';
      case 'premium':
        q.sort = 'price_desc';
      case 'new':
        q.sort = 'newest';
    }
    return q;
  }

  @override
  Widget build(BuildContext context) {
    final items = (rail['items'] as List).map((e) => VenueCard.fromJson(Map<String, dynamic>.from(e))).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionHeader(
        rail['title'],
        subtitle: rail['subtitle'],
        trailing: TextButton(
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(
              builder: (_) => ResultsScreen(query: _queryFor(rail['key'], context.read<AppState>().today), title: rail['title']))),
          child: const Text('See all'),
        ),
      ),
      SizedBox(
        height: 238,
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          scrollDirection: Axis.horizontal,
          itemCount: items.length,
          separatorBuilder: (_, __) => const SizedBox(width: 14),
          itemBuilder: (_, i) => VenueRailCard(items[i]),
        ),
      ),
    ]);
  }
}
