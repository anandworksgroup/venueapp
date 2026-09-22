import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import '../widgets/venue_card.dart';
import 'home_screen.dart';
import 'location_screens.dart';
import 'results_screen.dart';

/// Explore: every discovery rail, a map entry point and your saved venues.
class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key});
  @override
  State<ExploreScreen> createState() => _ExploreScreenState();
}

class _ExploreScreenState extends State<ExploreScreen> {
  Future<List<Map<String, dynamic>>>? _rails;
  Future<List<VenueCard>>? _saved;
  PlaceLocation? _loadedFor;
  int _savedCount = -1;

  void _load(AppState app) {
    _loadedFor = app.location;
    final loc = app.location;
    _rails = Api.instance.get('/discover/rails', {
      if (loc != null) 'lat': loc.lat,
      if (loc != null) 'lng': loc.lng,
      if (loc != null) 'location_label': loc.shortLabel,
    }).then((r) => List<Map<String, dynamic>>.from(r['rails']));
    _loadSaved(app);
  }

  void _loadSaved(AppState app) {
    _savedCount = app.savedIds.length;
    final loc = app.location;
    _saved = app.loggedIn
        ? Api.instance.get('/saved', {if (loc != null) 'lat': loc.lat, if (loc != null) 'lng': loc.lng}).then(
            (r) => (r['items'] as List).map((e) => VenueCard.fromJson(Map<String, dynamic>.from(e))).toList())
        : Future.value(<VenueCard>[]);
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    if (_rails == null || !identical(_loadedFor, app.location)) _load(app);
    if (_savedCount != app.savedIds.length) _loadSaved(app);
    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          color: Brand.teal,
          onRefresh: () async {
            setState(() => _load(app));
            await _rails;
          },
          child: CustomScrollView(slivers: [
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 12, 20, 0),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Explore venues', style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  const LocationBar(),
                  const SizedBox(height: 12),
                  const SearchBarButton(),
                  const SizedBox(height: 12),
                  Row(children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ResultsScreen(query: SearchQuery(radiusKm: 25), startOnMap: true, title: 'Venues on the map'))),
                        icon: const Icon(Icons.map_outlined),
                        label: const Text('Browse on map'),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ResultsScreen(query: SearchQuery(radiusKm: 50), title: 'All venues'))),
                        icon: const Icon(Icons.view_list_rounded),
                        label: const Text('All venues'),
                      ),
                    ),
                  ]),
                ]),
              ),
            ),
            SliverToBoxAdapter(
              child: FutureBuilder<List<VenueCard>>(
                future: _saved,
                builder: (context, snap) {
                  final items = snap.data ?? const [];
                  if (items.isEmpty) return const SizedBox.shrink();
                  return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    SectionHeader('Saved', subtitle: '${items.length} venue${items.length == 1 ? '' : 's'} you liked'),
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
                },
              ),
            ),
            SliverToBoxAdapter(
              child: FutureBuilder<List<Map<String, dynamic>>>(
                future: _rails,
                builder: (context, snap) {
                  if (snap.hasError) return SizedBox(height: 300, child: ErrorView(error: snap.error!, onRetry: () => setState(() => _load(app))));
                  if (!snap.hasData) return const SizedBox(height: 300, child: LoadingView());
                  return Column(children: [for (final r in snap.data!) VenueRail(rail: r)]);
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
