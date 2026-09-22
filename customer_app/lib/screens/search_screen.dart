import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../state/app_state.dart';
import 'results_screen.dart';
import 'venue_screen.dart';

/// Free-text search that understands intent: "wedding venue near Sector 21
/// under 2 lakh" → event, place, budget chips before you even hit search.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});
  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final _c = TextEditingController();
  Timer? _debounce;
  Map<String, dynamic>? _suggest;
  static final List<String> _recent = [];

  static const _examples = [
    'wedding venue for 500 guests',
    'banquet hall in Sector 15',
    'birthday party this weekend',
    'marriage lawn under 2 lakh',
    'corporate event near me',
    'farmhouse with rooms and parking',
  ];

  @override
  void dispose() {
    _debounce?.cancel();
    _c.dispose();
    super.dispose();
  }

  void _changed(String v) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 250), () async {
      if (v.trim().length < 2) {
        setState(() => _suggest = null);
        return;
      }
      try {
        final r = await Api.instance.get('/search/suggest', {'q': v});
        if (mounted && _c.text == v) setState(() => _suggest = Map<String, dynamic>.from(r));
      } catch (_) {}
    });
  }

  void _submit(String text) {
    final t = text.trim();
    if (t.isEmpty) return;
    _recent.remove(t);
    _recent.insert(0, t);
    if (_recent.length > 6) _recent.removeLast();
    Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ResultsScreen(query: SearchQuery(q: t))));
  }

  String _chip(Map u, AppState app) => switch (u['field']) {
        'event' => app.categoryName(u['value']),
        'venue_type' => titleCase(u['value']),
        'date' => u['value'].toString().contains('–') ? u['value'] : dateWithDay(u['value']),
        'facility' => app.facilityName(u['value']),
        'slot' => titleCase(u['value'].toString().toLowerCase()),
        'keywords' => '“${u['value']}”',
        _ => u['value'].toString(),
      };

  @override
  Widget build(BuildContext context) {
    final app = context.watch<AppState>();
    final understood = (_suggest?['parsed']?['understood'] as List?) ?? [];
    final venues = (_suggest?['venues'] as List?) ?? [];
    final cats = (_suggest?['categories'] as List?) ?? [];
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: TextField(
          controller: _c,
          autofocus: true,
          onChanged: _changed,
          onSubmitted: _submit,
          textInputAction: TextInputAction.search,
          decoration: InputDecoration(
            hintText: 'Search venues, areas, services…',
            border: InputBorder.none,
            enabledBorder: InputBorder.none,
            focusedBorder: InputBorder.none,
            fillColor: Colors.transparent,
            suffixIcon: _c.text.isEmpty ? null : IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => setState(() {
                  _c.clear();
                  _suggest = null;
                })),
          ),
        ),
      ),
      body: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
        if (understood.isNotEmpty) ...[
          const Text('WE UNDERSTOOD', style: TextStyle(color: Brand.muted, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 0.8)),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final u in understood)
              Chip(
                avatar: const Icon(Icons.check_circle_rounded, size: 16, color: Brand.teal),
                label: Text(_chip(u, app)),
                backgroundColor: Brand.tealSoft,
              ),
          ]),
          const SizedBox(height: 12),
          FilledButton.icon(onPressed: () => _submit(_c.text), icon: const Icon(Icons.search_rounded), label: const Text('Show matching venues')),
          const SizedBox(height: 16),
        ],
        if (cats.isNotEmpty)
          for (final c in cats)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(backgroundColor: Brand.marigoldSoft, child: Icon(categoryIcon(c['code']), color: Brand.marigold)),
              title: Text('${c['name']} venues', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: const Text('Category'),
              onTap: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => ResultsScreen(query: SearchQuery(event: c['code'])))),
            ),
        if (venues.isNotEmpty)
          for (final v in venues)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const CircleAvatar(backgroundColor: Brand.tealSoft, child: Icon(Icons.storefront_rounded, color: Brand.teal)),
              title: Text(v['name'], style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text([v['area'], v['city']].whereType<String>().join(', ')),
              onTap: () => Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => VenueScreen(venueId: v['id']))),
            ),
        if (_suggest == null) ...[
          if (_recent.isNotEmpty) ...[
            const Text('RECENT', style: TextStyle(color: Brand.muted, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 0.8)),
            for (final r in _recent)
              ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.history_rounded), title: Text(r), onTap: () => _submit(r)),
            const SizedBox(height: 16),
          ],
          const Text('TRY SEARCHING', style: TextStyle(color: Brand.muted, fontWeight: FontWeight.w800, fontSize: 12, letterSpacing: 0.8)),
          const SizedBox(height: 10),
          Wrap(spacing: 8, runSpacing: 8, children: [
            for (final e in _examples)
              ActionChip(
                avatar: const Icon(Icons.north_west_rounded, size: 15),
                label: Text(e),
                onPressed: () {
                  _c.text = e;
                  _changed(e);
                },
              ),
          ]),
        ],
      ]),
    );
  }
}
