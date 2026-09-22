import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import '../widgets/cover_art.dart';
import '../widgets/venue_card.dart';
import 'filters_sheet.dart';
import 'search_screen.dart';

class ResultsScreen extends StatefulWidget {
  final SearchQuery query;
  final String? title;
  final bool startOnMap;
  const ResultsScreen({super.key, required this.query, this.title, this.startOnMap = false});
  @override
  State<ResultsScreen> createState() => _ResultsScreenState();
}

class _ResultsScreenState extends State<ResultsScreen> {
  late SearchQuery q = widget.query.copy();
  late bool _map = widget.startOnMap;
  Future<Map<String, dynamic>>? _future;
  VenueCard? _selected;

  @override
  void initState() {
    super.initState();
    _run();
  }

  void _run() {
    final loc = context.read<AppState>().location;
    _selected = null;
    _future = Api.instance.get('/venues', q.toParams(loc)).then((r) => Map<String, dynamic>.from(r));
  }

  Future<void> _openFilters() async {
    final updated = await showFiltersSheet(context, q);
    if (updated == null) return;
    setState(() {
      q = updated;
      _run();
    });
  }

  Future<void> _openSort(String current, String explanation) async {
    final app = context.read<AppState>();
    final v = await showModalBottomSheet<String>(
      context: context,
      builder: (c) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 4), child: Text('Sort by', style: Theme.of(c).textTheme.titleLarge)),
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
            child: Text('We never rank venues by a hidden score — pick what matters to you.', style: const TextStyle(color: Brand.inkSoft)),
          ),
          for (final s in app.sorts)
            RadioListTile<String>(
              value: s.code,
              groupValue: current,
              activeColor: Brand.teal,
              title: Text(s.name, style: const TextStyle(fontWeight: FontWeight.w600)),
              onChanged: (v) => Navigator.pop(c, v),
            ),
        ]),
      ),
    );
    if (v == null || v == current) return;
    setState(() {
      q.sort = v;
      _run();
    });
  }

  /// What the server actually searched for (including what it understood
  /// from free text), carried into the venue page and availability screen.
  SearchQuery _effective(Map<String, dynamic> data) {
    final a = Map<String, dynamic>.from(data['applied'] ?? {});
    final dates = (a['dates'] as List?) ?? const [];
    return q.copy()
      ..event = a['event'] ?? q.event
      ..guests = (a['guests'] as num?)?.toInt() ?? q.guests
      ..date = dates.length == 1 ? dates.first as String : q.date
      ..dateFrom = a['date_from'] ?? q.dateFrom
      ..slot = a['slot'] ?? q.slot;
  }

  String _title(AppState app) {
    if (widget.title != null) return widget.title!;
    if (q.q != null) return '“${q.q}”';
    if (q.event != null) return '${app.categoryName(q.event).replaceAll(' Event', '')} venues';
    return 'Venues';
  }

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(
        title: Text(_title(app), maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: [
          IconButton(
            tooltip: 'New search',
            icon: const Icon(Icons.search_rounded),
            onPressed: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => const SearchScreen())),
          ),
        ],
      ),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _future,
        builder: (context, snap) {
          final data = snap.data;
          final items = data == null ? <VenueCard>[] : (data['items'] as List).map((e) => VenueCard.fromJson(Map<String, dynamic>.from(e))).toList();
          final sort = data?['sort'] ?? q.sort ?? 'distance';
          final narrow = MediaQuery.sizeOf(context).width < 420;
          final effective = data == null ? q : _effective(data);
          return Column(children: [
            _SummaryBar(q: q, app: app, data: data),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 6),
              child: Row(children: [
                _ToolButton(
                  icon: Icons.tune_rounded,
                  label: q.activeFilterCount > 0 ? 'Filters · ${q.activeFilterCount}' : 'Filters',
                  active: q.activeFilterCount > 0,
                  onTap: _openFilters,
                ),
                const SizedBox(width: 8),
                _ToolButton(
                  icon: Icons.swap_vert_rounded,
                  label: app.sorts.firstWhere((s) => s.code == sort, orElse: () => (code: sort, name: 'Sort')).name,
                  onTap: () => _openSort(sort, data?['sort_explanation'] ?? ''),
                ),
                const Spacer(),
                SegmentedButton<bool>(
                  showSelectedIcon: false,
                  style: SegmentedButton.styleFrom(
                    selectedBackgroundColor: Brand.teal,
                    selectedForegroundColor: Colors.white,
                    visualDensity: VisualDensity.compact,
                  ),
                  segments: [
                    ButtonSegment(value: false, label: const Text('LIST'), icon: narrow ? null : const Icon(Icons.view_agenda_outlined, size: 18)),
                    ButtonSegment(value: true, label: const Text('MAP'), icon: narrow ? null : const Icon(Icons.map_outlined, size: 18)),
                  ],
                  selected: {_map},
                  onSelectionChanged: (s) => setState(() => _map = s.first),
                ),
              ]),
            ),
            Expanded(
              child: snap.hasError
                  ? ErrorView(error: snap.error!, onRetry: () => setState(_run))
                  : !snap.hasData
                      ? const LoadingView(message: 'Checking venues and availability…')
                      : items.isEmpty
                          ? EmptyView(
                              icon: Icons.search_off_rounded,
                              title: 'No venues match all of that',
                              message: 'Try a wider radius, another date, or fewer filters.',
                              action: OutlinedButton(onPressed: _openFilters, child: const Text('Adjust filters')),
                            )
                          : _map
                              ? _MapView(items: items, data: data!, selected: _selected, onSelect: (v) => setState(() => _selected = v), query: effective)
                              : _ListView(items: items, data: data!, query: effective),
            ),
          ]);
        },
      ),
    );
  }
}

class _SummaryBar extends StatelessWidget {
  final SearchQuery q;
  final AppState app;
  final Map<String, dynamic>? data;
  const _SummaryBar({required this.q, required this.app, required this.data});

  @override
  Widget build(BuildContext context) {
    final applied = data?['applied'] as Map?;
    final center = data?['center'] as Map?;
    final dates = (applied?['dates'] as List?) ?? const [];
    final guests = applied?['guests'] ?? q.guests;
    final chips = <(IconData, String)>[
      (Icons.place_rounded, center?['label'] ?? app.location?.shortLabel ?? 'Anywhere'),
      if (dates.isNotEmpty) (Icons.calendar_today_rounded, dates.length == 1 ? dateShort(dates.first) : '${dateShort(dates.first)} – ${dateShort(dates.last)}'),
      if (guests != null) (Icons.groups_rounded, '$guests guests'),
      if (applied?['budget_max'] != null) (Icons.currency_rupee_rounded, 'Under ${inrShort(applied!['budget_max'])}'),
      if (applied?['radius_km'] != null) (Icons.radar_rounded, 'Within ${applied!['radius_km']} km'),
    ];
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(children: [
          for (final (icon, label) in chips)
            Padding(
              padding: const EdgeInsets.only(right: 14),
              child: Row(children: [
                Icon(icon, size: 16, color: Brand.marigold),
                const SizedBox(width: 4),
                Text(label, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13.5)),
              ]),
            ),
        ]),
      ),
    );
  }
}

class _ToolButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool active;
  final VoidCallback onTap;
  const _ToolButton({required this.icon, required this.label, required this.onTap, this.active = false});
  @override
  Widget build(BuildContext context) => Material(
        color: active ? Brand.tealSoft : Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: active ? Brand.teal : Brand.line)),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              Icon(icon, size: 18, color: active ? Brand.teal : Brand.ink),
              const SizedBox(width: 6),
              ConstrainedBox(
                constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width < 420 ? 72 : 120),
                child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: FontWeight.w700, color: active ? Brand.teal : Brand.ink)),
              ),
            ]),
          ),
        ),
      );
}

class _ListView extends StatelessWidget {
  final List<VenueCard> items;
  final Map<String, dynamic> data;
  final SearchQuery query;
  const _ListView({required this.items, required this.data, required this.query});

  @override
  Widget build(BuildContext context) {
    final app = context.read<AppState>();
    final understood = (data['understood'] as List?) ?? const [];
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
      itemCount: items.length + 1,
      separatorBuilder: (_, i) => SizedBox(height: i == 0 ? 10 : 18),
      itemBuilder: (context, i) {
        if (i == 0) {
          return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (understood.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final u in understood)
                    if (u['field'] != 'keywords')
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                        decoration: BoxDecoration(color: Brand.tealSoft, borderRadius: BorderRadius.circular(8)),
                        child: Text(
                          switch (u['field']) {
                            'event' => app.categoryName(u['value']),
                            'venue_type' => titleCase(u['value']),
                            'facility' => app.facilityName(u['value']),
                            'date' => u['value'].toString().length == 10 ? dateWithDay(u['value']) : u['value'].toString(),
                            _ => u['value'].toString(),
                          },
                          style: const TextStyle(color: Brand.teal, fontWeight: FontWeight.w700, fontSize: 12),
                        ),
                      ),
                ]),
              ),
            Text('${data['total']} venue${data['total'] == 1 ? '' : 's'} found', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 2),
            Text(data['sort_explanation'] ?? '', style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
          ]);
        }
        return VenueListCard(items[i - 1], query: query);
      },
    );
  }
}

class _MapView extends StatelessWidget {
  final List<VenueCard> items;
  final Map<String, dynamic> data;
  final VenueCard? selected;
  final ValueChanged<VenueCard?> onSelect;
  final SearchQuery query;
  const _MapView({required this.items, required this.data, required this.selected, required this.onSelect, required this.query});

  @override
  Widget build(BuildContext context) {
    final loc = context.read<AppState>().location;
    final center = data['center'] as Map?;
    final c = center != null
        ? LatLng((center['lat'] as num).toDouble(), (center['lng'] as num).toDouble())
        : loc != null
            ? LatLng(loc.lat, loc.lng)
            : LatLng(items.first.lat ?? 28.41, items.first.lng ?? 77.31);
    final pts = items.where((v) => v.lat != null).map((v) => LatLng(v.lat!, v.lng!)).toList();
    return Stack(children: [
      FlutterMap(
        options: MapOptions(
          initialCenter: c,
          initialZoom: 12,
          initialCameraFit: pts.length > 1 ? CameraFit.coordinates(coordinates: [...pts, c], padding: const EdgeInsets.all(56), maxZoom: 14) : null,
          onTap: (_, __) => onSelect(null),
        ),
        children: [
          TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'in.pandal.pandal'),
          MarkerLayer(markers: [
            if (loc != null)
              Marker(
                point: LatLng(loc.lat, loc.lng),
                width: 22,
                height: 22,
                child: Container(decoration: BoxDecoration(color: const Color(0xFF2F80ED), shape: BoxShape.circle, border: Border.all(color: Colors.white, width: 3), boxShadow: const [BoxShadow(color: Color(0x552F80ED), blurRadius: 10, spreadRadius: 4)])),
              ),
            for (final v in items.where((v) => v.lat != null))
              Marker(
                point: LatLng(v.lat!, v.lng!),
                width: 78,
                height: 36,
                child: GestureDetector(
                  onTap: () => onSelect(v),
                  child: Center(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: selected?.id == v.id ? Brand.teal : Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: selected?.id == v.id ? Brand.teal : Brand.line),
                        boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 6, offset: Offset(0, 2))],
                      ),
                      child: Text(inrShort(v.startingPrice), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 12.5, color: selected?.id == v.id ? Colors.white : Brand.ink)),
                    ),
                  ),
                ),
              ),
          ]),
          const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
        ],
      ),
      Positioned(
        top: 10,
        left: 0,
        right: 0,
        child: Center(
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20), boxShadow: const [BoxShadow(color: Color(0x22000000), blurRadius: 8)]),
            child: Text('${data['total']} venues · prices are starting rentals', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
          ),
        ),
      ),
      if (selected != null)
        Positioned(
          left: 16,
          right: 16,
          bottom: 20,
          child: Material(
            color: Colors.white,
            elevation: 6,
            borderRadius: BorderRadius.circular(18),
            child: InkWell(
              borderRadius: BorderRadius.circular(18),
              onTap: () => openVenue(context, selected!, query: query),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Row(children: [
                  SizedBox(width: 92, height: 76, child: CoverArt(hue: selected!.coverHue, seed: selected!.id, imageUrl: selected!.coverImage, radius: 12)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(selected!.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                      const SizedBox(height: 4),
                      RatingBadge(rating: selected!.rating, count: selected!.ratingCount),
                      const SizedBox(height: 4),
                      Text('${inr(selected!.startingPrice)} onwards${selected!.distanceKm != null ? ' · ${selected!.distanceKm} km' : ''}', style: const TextStyle(color: Brand.inkSoft, fontSize: 13)),
                    ]),
                  ),
                  FilledButton(
                    style: FilledButton.styleFrom(minimumSize: const Size(64, 40)),
                    onPressed: () => openVenue(context, selected!, query: query),
                    child: const Text('View'),
                  ),
                ]),
              ),
            ),
          ),
        ),
    ]);
  }
}
