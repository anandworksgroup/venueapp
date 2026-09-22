import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:provider/provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../data/api.dart';
import '../data/models.dart';
import '../state/app_state.dart';
import '../widgets/common.dart';
import '../widgets/cover_art.dart';
import '../widgets/venue_card.dart';
import 'availability_screen.dart';

Future<void> openDirections(double? lat, double? lng) async {
  if (lat == null || lng == null) return;
  await launchUrl(Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng'), mode: LaunchMode.externalApplication);
}

class VenueScreen extends StatefulWidget {
  final String venueId;
  final VenueCard? preview;
  final SearchQuery? query;
  const VenueScreen({super.key, required this.venueId, this.preview, this.query});
  @override
  State<VenueScreen> createState() => _VenueScreenState();
}

class _VenueScreenState extends State<VenueScreen> {
  late Future<VenueDetail> _future;
  final _sectionKeys = {for (final s in _sections) s: GlobalKey()};
  static const _sections = ['About', 'Capacity', 'Facilities', 'Spaces', 'Packages', 'Pricing', 'Availability', 'Reviews', 'Location', 'Policies'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    final loc = context.read<AppState>().location;
    _future = Api.instance
        .get('/venues/${widget.venueId}', {if (loc != null) 'lat': loc.lat, if (loc != null) 'lng': loc.lng})
        .then((j) => VenueDetail.fromJson(Map<String, dynamic>.from(j)));
  }

  void _jump(String s) {
    final ctx = _sectionKeys[s]?.currentContext;
    if (ctx != null) Scrollable.ensureVisible(ctx, duration: const Duration(milliseconds: 350), alignment: 0.05);
  }

  void _checkAvailability(VenueDetail v) {
    Navigator.of(context).push(MaterialPageRoute(settings: const RouteSettings(name: 'availability'), builder: (_) => AvailabilityScreen(venue: v, query: widget.query)));
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<VenueDetail>(
      future: _future,
      builder: (context, snap) {
        if (snap.hasError) {
          return Scaffold(appBar: AppBar(), body: ErrorView(error: snap.error!, onRetry: () => setState(_load)));
        }
        if (!snap.hasData) {
          final p = widget.preview;
          return Scaffold(
            body: Column(children: [
              SizedBox(height: 300, child: p == null ? const ColoredBox(color: Brand.tealSoft) : CoverArt(hue: p.coverHue, seed: p.id, imageUrl: p.coverImage)),
              const Expanded(child: LoadingView()),
            ]),
          );
        }
        final v = snap.data!;
        return Scaffold(
          body: CustomScrollView(slivers: [
            _Gallery(v: v),
            SliverToBoxAdapter(child: _Header(v: v)),
            SliverPersistentHeader(pinned: true, delegate: _TabsDelegate(sections: _sections, onTap: _jump)),
            SliverList(
              delegate: SliverChildListDelegate([
                _Section(key: _sectionKeys['About'], title: 'About', child: _About(v: v)),
                _Section(key: _sectionKeys['Capacity'], title: 'Capacity', child: _Capacity(v: v)),
                _Section(key: _sectionKeys['Facilities'], title: 'Facilities', child: _Facilities(v: v)),
                _Section(key: _sectionKeys['Spaces'], title: 'Spaces', subtitle: 'Each space is booked separately — so availability is always real.', child: _Spaces(v: v)),
                _Section(key: _sectionKeys['Packages'], title: 'Packages', child: _Packages(v: v)),
                _Section(key: _sectionKeys['Pricing'], title: 'Pricing', child: _Pricing(v: v)),
                _Section(key: _sectionKeys['Availability'], title: 'Availability', child: _AvailabilityTeaser(v: v, onOpen: () => _checkAvailability(v))),
                _Section(key: _sectionKeys['Reviews'], title: 'Reviews', subtitle: 'Only guests with a completed booking can review.', child: _Reviews(v: v)),
                _Section(key: _sectionKeys['Location'], title: 'Location', child: _Location(v: v)),
                _Section(key: _sectionKeys['Policies'], title: 'Policies', child: _Policies(v: v)),
                const SizedBox(height: 120),
              ]),
            ),
          ]),
          bottomNavigationBar: SafeArea(
            top: false,
            child: Container(
              padding: const EdgeInsets.fromLTRB(20, 10, 16, 10),
              decoration: const BoxDecoration(color: Colors.white, border: Border(top: BorderSide(color: Brand.line))),
              child: Row(children: [
                Expanded(
                  child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
                    const Text('Starting from', style: TextStyle(color: Brand.inkSoft, fontSize: 12.5)),
                    Text(inr(v.card.startingPrice), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                  ]),
                ),
                FilledButton(onPressed: () => _checkAvailability(v), child: const Text('Check availability')),
              ]),
            ),
          ),
        );
      },
    );
  }
}

class _Gallery extends StatefulWidget {
  final VenueDetail v;
  const _Gallery({required this.v});
  @override
  State<_Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<_Gallery> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final v = widget.v;
    final photos = v.gallery.where((g) => g.mediaType == 'photo').toList();
    final videos = v.gallery.where((g) => g.mediaType == 'video').toList();
    final pages = photos.isEmpty ? 1 : photos.length;
    final saved = context.select<AppState, bool>((a) => a.savedIds.contains(v.id));
    return SliverAppBar(
      expandedHeight: 300,
      pinned: true,
      backgroundColor: Brand.teal,
      foregroundColor: Colors.white,
      leading: Padding(
        padding: const EdgeInsets.all(6),
        child: CircleAvatar(backgroundColor: Colors.white, child: BackButton(color: Brand.ink, onPressed: () => Navigator.pop(context))),
      ),
      actions: [
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: CircleAvatar(
            backgroundColor: Colors.white,
            child: IconButton(
              icon: Icon(saved ? Icons.favorite_rounded : Icons.favorite_border_rounded, color: saved ? const Color(0xFFE0245E) : Brand.ink),
              onPressed: () => toggleSave(context, v.id),
            ),
          ),
        ),
      ],
      flexibleSpace: FlexibleSpaceBar(
        background: Stack(fit: StackFit.expand, children: [
          PageView.builder(
            itemCount: pages,
            onPageChanged: (i) => setState(() => _page = i),
            itemBuilder: (_, i) => CoverArt(hue: v.card.coverHue, seed: '${v.id}$i', imageUrl: photos.isEmpty ? null : photos[i].url),
          ),
          Positioned(
            right: 14,
            bottom: 14,
            child: Row(children: [
              if (videos.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ActionChip(
                    avatar: const Icon(Icons.play_circle_fill_rounded, size: 18),
                    label: Text('Video${videos.length > 1 ? 's' : ''}'),
                    onPressed: () => launchUrl(Uri.parse(videos.first.url), mode: LaunchMode.externalApplication),
                  ),
                ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(20)),
                child: Text(
                  photos.isEmpty ? 'Photos coming soon' : '${_page + 1}/${photos.length} · ${titleCase(photos[_page].category)}',
                  style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 12),
                ),
              ),
            ]),
          ),
        ]),
      ),
    );
  }
}

class _Header extends StatelessWidget {
  final VenueDetail v;
  const _Header({required this.v});

  @override
  Widget build(BuildContext context) {
    final c = v.card;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 8),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Expanded(child: Text(v.name, style: Theme.of(context).textTheme.headlineSmall)),
          if (c.locationVerified)
            const Tooltip(message: 'Location verified by Pandal', child: Icon(Icons.verified_rounded, color: Brand.teal)),
        ]),
        const SizedBox(height: 6),
        Row(children: [
          RatingBadge(rating: c.rating, count: c.ratingCount),
          const SizedBox(width: 10),
          Text(c.venueTypeLabel, style: const TextStyle(color: Brand.inkSoft, fontWeight: FontWeight.w600)),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          const Icon(Icons.place_outlined, size: 18, color: Brand.marigold),
          const SizedBox(width: 4),
          Expanded(child: Text(c.place, style: const TextStyle(fontWeight: FontWeight.w600))),
        ]),
        if (c.distanceKm != null)
          Padding(
            padding: const EdgeInsets.only(left: 22, top: 2),
            child: Text('${c.distanceKm} km away', style: const TextStyle(color: Brand.inkSoft)),
          ),
        const SizedBox(height: 14),
        Row(children: [
          Expanded(child: _ActionButton(icon: Icons.directions_rounded, label: 'Directions', onTap: () => openDirections(c.lat, c.lng))),
          const SizedBox(width: 8),
          Expanded(
            child: _ActionButton(
              icon: Icons.ios_share_rounded,
              label: 'Share',
              onTap: () => SharePlus.instance.share(ShareParams(
                text: '${v.name} — ${c.place}\n${c.rating > 0 ? '★ ${c.rating} (${c.ratingCount} reviews) · ' : ''}Starting ${inr(c.startingPrice)} · up to ${c.capacityMax} guests\nFound on Pandal',
                subject: v.name,
              )),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Builder(builder: (context) {
              final saved = context.select<AppState, bool>((a) => a.savedIds.contains(v.id));
              return _ActionButton(
                icon: saved ? Icons.favorite_rounded : Icons.favorite_border_rounded,
                color: saved ? const Color(0xFFE0245E) : null,
                label: saved ? 'Saved' : 'Save',
                onTap: () => toggleSave(context, v.id),
              );
            }),
          ),
        ]),
      ]),
    );
  }
}

class _ActionButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color? color;
  const _ActionButton({required this.icon, required this.label, required this.onTap, this.color});
  @override
  Widget build(BuildContext context) => Material(
        color: Colors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14), side: const BorderSide(color: Brand.line, width: 1.5)),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Column(children: [
              Icon(icon, color: color ?? Brand.teal, size: 22),
              const SizedBox(height: 3),
              Text(label, style: const TextStyle(color: Brand.teal, fontWeight: FontWeight.w700, fontSize: 13)),
            ]),
          ),
        ),
      );
}

class _TabsDelegate extends SliverPersistentHeaderDelegate {
  final List<String> sections;
  final ValueChanged<String> onTap;
  _TabsDelegate({required this.sections, required this.onTap});
  @override
  double get minExtent => 50;
  @override
  double get maxExtent => 50;
  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) => Container(
        color: Brand.cream,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          children: [
            for (final s in sections)
              Padding(
                padding: const EdgeInsets.only(right: 6),
                child: ActionChip(label: Text(s, style: const TextStyle(fontSize: 13)), onPressed: () => onTap(s), visualDensity: VisualDensity.compact),
              ),
          ],
        ),
      );
  @override
  bool shouldRebuild(covariant _TabsDelegate old) => false;
}

class _Section extends StatelessWidget {
  final String title;
  final String? subtitle;
  final Widget child;
  const _Section({super.key, required this.title, this.subtitle, required this.child});
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SectionHeader(title, subtitle: subtitle, padding: const EdgeInsets.fromLTRB(20, 22, 20, 10)),
        child,
      ]);
}

class _About extends StatefulWidget {
  final VenueDetail v;
  const _About({required this.v});
  @override
  State<_About> createState() => _AboutState();
}

class _AboutState extends State<_About> {
  bool _more = false;
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(widget.v.description, maxLines: _more ? null : 4, overflow: _more ? null : TextOverflow.ellipsis, style: const TextStyle(height: 1.5, fontSize: 15)),
          if (widget.v.description.length > 220)
            TextButton(onPressed: () => setState(() => _more = !_more), style: TextButton.styleFrom(padding: EdgeInsets.zero), child: Text(_more ? 'Show less' : 'Read more')),
          const SizedBox(height: 6),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final e in widget.v.card.eventTypes)
              Chip(avatar: Icon(categoryIcon(e), size: 16), label: Text(context.read<AppState>().categoryName(e)), visualDensity: VisualDensity.compact),
          ]),
          if (widget.v.businessName != null) ...[
            const SizedBox(height: 8),
            Text('Managed by ${widget.v.businessName}', style: const TextStyle(color: Brand.muted, fontSize: 13)),
          ],
        ]),
      );
}

class _Capacity extends StatelessWidget {
  final VenueDetail v;
  const _Capacity({required this.v});
  @override
  Widget build(BuildContext context) {
    final c = v.capacity;
    final tiles = <(IconData, String, String)>[
      if (c['indoor'] != null) (Icons.meeting_room_rounded, 'Indoor', '${c['indoor']} guests'),
      if (c['outdoor'] != null) (Icons.park_rounded, 'Outdoor', '${c['outdoor']} guests'),
      if (c['dining'] != null) (Icons.restaurant_rounded, 'Dining', '${c['dining']} seated'),
      if (c['parking_cars'] != null) (Icons.local_parking_rounded, 'Parking', '${c['parking_cars']} cars'),
      if (c['rooms'] != null) (Icons.bed_rounded, 'Rooms', '${c['rooms']} rooms'),
    ];
    return SizedBox(
      height: 96,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        scrollDirection: Axis.horizontal,
        itemCount: tiles.length,
        separatorBuilder: (_, __) => const SizedBox(width: 10),
        itemBuilder: (_, i) {
          final (icon, label, value) = tiles[i];
          return Container(
            width: 118,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: Brand.line)),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
              Icon(icon, color: Brand.teal),
              Text(label, style: const TextStyle(color: Brand.inkSoft, fontSize: 12.5)),
              Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
            ]),
          );
        },
      ),
    );
  }
}

class _Facilities extends StatelessWidget {
  final VenueDetail v;
  const _Facilities({required this.v});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        child: Wrap(spacing: 10, runSpacing: 10, children: [
          for (final f in v.facilityLabels)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: Brand.line)),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                Icon(facilityIcon(f.code), size: 18, color: Brand.teal),
                const SizedBox(width: 6),
                Text(f.label, style: const TextStyle(fontWeight: FontWeight.w600)),
              ]),
            ),
        ]),
      );
}

class _Spaces extends StatelessWidget {
  final VenueDetail v;
  const _Spaces({required this.v});
  @override
  Widget build(BuildContext context) => Column(children: [
        for (final s in v.spaces)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Panel(
              child: Row(children: [
                SizedBox(width: 74, height: 74, child: CoverArt(hue: v.card.coverHue + 30, seed: s.id, imageUrl: s.images.isEmpty ? null : s.images.first, radius: 12)),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(s.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                    const SizedBox(height: 2),
                    Text('${titleCase(s.kind)} · ${s.seated} seated · ${s.floating} floating', style: const TextStyle(color: Brand.inkSoft, fontSize: 13)),
                    if (s.minGuests > 0) Text('Minimum ${s.minGuests} guests', style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
                    const SizedBox(height: 4),
                    Text('From ${inr(s.prices.values.fold<int>(1 << 30, (a, b) => b < a ? b : a))}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  ]),
                ),
              ]),
            ),
          ),
      ]);
}

class _Packages extends StatelessWidget {
  final VenueDetail v;
  const _Packages({required this.v});

  static String priceText(VenuePackage p) => switch (p.pricingMode) {
        'included' => 'Included',
        'per_plate' => '${inr(p.price)} / plate',
        _ => '+ ${inr(p.price)}',
      };

  @override
  Widget build(BuildContext context) => SizedBox(
        height: 250,
        child: ListView.separated(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          scrollDirection: Axis.horizontal,
          itemCount: v.packages.length,
          separatorBuilder: (_, __) => const SizedBox(width: 12),
          itemBuilder: (_, i) {
            final p = v.packages[i];
            final featured = p.tier == 'premium';
            return Container(
              width: 250,
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: featured ? Brand.teal : Colors.white,
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: featured ? Brand.teal : Brand.line),
              ),
              child: DefaultTextStyle.merge(
                style: TextStyle(color: featured ? Colors.white : Brand.ink),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Expanded(child: Text(p.name, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))),
                    if (featured)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(color: Brand.marigold, borderRadius: BorderRadius.circular(8)),
                        child: const Text('POPULAR', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w900, color: Colors.white)),
                      ),
                  ]),
                  const SizedBox(height: 4),
                  Text(priceText(p), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
                  if (p.pricingMode == 'per_plate' && p.minGuests > 0) Text('Min ${p.minGuests} plates · venue included', style: TextStyle(fontSize: 12, color: featured ? Colors.white70 : Brand.muted)),
                  const SizedBox(height: 10),
                  Expanded(
                    child: ListView(
                      physics: const NeverScrollableScrollPhysics(),
                      padding: EdgeInsets.zero,
                      children: [
                        for (final inc in p.inclusions.take(6))
                          Padding(
                            padding: const EdgeInsets.only(bottom: 5),
                            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                              Icon(Icons.check_rounded, size: 16, color: featured ? Brand.marigold : Brand.available),
                              const SizedBox(width: 6),
                              Expanded(child: Text(inc.label, style: const TextStyle(fontSize: 13), maxLines: 1, overflow: TextOverflow.ellipsis)),
                            ]),
                          ),
                      ],
                    ),
                  ),
                ]),
              ),
            );
          },
        ),
      );
}

class _Pricing extends StatelessWidget {
  final VenueDetail v;
  const _Pricing({required this.v});
  @override
  Widget build(BuildContext context) => Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Starting from', style: TextStyle(color: Brand.inkSoft)),
          Text(inr(v.card.startingPrice), style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w900)),
          if (v.perPlateFrom != null) ...[
            const SizedBox(height: 4),
            Text('or from ${inr(v.perPlateFrom)} / plate with a catering package (venue included)', style: const TextStyle(fontWeight: FontWeight.w600)),
          ],
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Brand.marigoldSoft, borderRadius: BorderRadius.circular(12)),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Icon(Icons.info_outline_rounded, size: 18, color: Color(0xFFA86400)),
              const SizedBox(width: 8),
              Expanded(child: Text('What "starting from" means: ${v.startingPriceExplained ?? 'the lowest venue rental.'}', style: const TextStyle(fontSize: 13, height: 1.4))),
            ]),
          ),
          const SizedBox(height: 14),
          Table(
            columnWidths: const {0: FlexColumnWidth(1.6)},
            children: [
              const TableRow(children: [
                _Th('Space'),
                _Th('Morning'),
                _Th('Evening'),
                _Th('Full day'),
              ]),
              for (final s in v.spaces)
                TableRow(children: [
                  _Td(s.name, bold: true),
                  _Td(inrShort(s.prices['MORNING'])),
                  _Td(inrShort(s.prices['EVENING'])),
                  _Td(inrShort(s.prices['FULL_DAY'])),
                ]),
            ],
          ),
          if (v.weekendSurcharge)
            const Padding(padding: EdgeInsets.only(top: 8), child: Text('Some spaces add a weekend surcharge (Fri–Sun), shown before you pay.', style: TextStyle(color: Brand.muted, fontSize: 12.5))),
          const SizedBox(height: 6),
          Text('Advance to confirm: ${v.advancePct}% of the total · GST extra', style: const TextStyle(color: Brand.muted, fontSize: 12.5)),
        ]),
      );
}

class _Th extends StatelessWidget {
  final String t;
  const _Th(this.t);
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(t, style: const TextStyle(color: Brand.muted, fontSize: 12, fontWeight: FontWeight.w700)));
}

class _Td extends StatelessWidget {
  final String t;
  final bool bold;
  const _Td(this.t, {this.bold = false});
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Text(t, style: TextStyle(fontWeight: bold ? FontWeight.w700 : FontWeight.w500, fontSize: 13.5)));
}

class _AvailabilityTeaser extends StatefulWidget {
  final VenueDetail v;
  final VoidCallback onOpen;
  const _AvailabilityTeaser({required this.v, required this.onOpen});
  @override
  State<_AvailabilityTeaser> createState() => _AvailabilityTeaserState();
}

class _AvailabilityTeaserState extends State<_AvailabilityTeaser> {
  late Future<List<Map<String, dynamic>>> _days;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    final next = DateTime(now.year, now.month + 1);
    String m(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}';
    _days = Future.wait([
      Api.instance.get('/venues/${widget.v.id}/availability', {'month': m(now)}),
      Api.instance.get('/venues/${widget.v.id}/availability', {'month': m(next)}),
    ]).then((rs) => [for (final r in rs) ...List<Map<String, dynamic>>.from(r['days'])].where((d) => d['date'].compareTo(isoDate(now)) >= 0).take(14).toList());
  }

  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        SizedBox(
          height: 78,
          child: FutureBuilder<List<Map<String, dynamic>>>(
            future: _days,
            builder: (context, snap) {
              if (!snap.hasData) return const LoadingView();
              final days = snap.data!;
              return ListView.separated(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                scrollDirection: Axis.horizontal,
                itemCount: days.length,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (_, i) {
                  final d = parseDate(days[i]['date'])!;
                  final st = days[i]['status'];
                  return InkWell(
                    onTap: widget.onOpen,
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      width: 56,
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: Brand.line)),
                      child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][d.weekday - 1], style: const TextStyle(fontSize: 10.5, color: Brand.muted, fontWeight: FontWeight.w700)),
                        Text('${d.day}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 3),
                        AvailabilityDot(st, size: 8),
                      ]),
                    ),
                  );
                },
              );
            },
          ),
        ),
        const SizedBox(height: 10),
        const Padding(padding: EdgeInsets.symmetric(horizontal: 20), child: AvailabilityLegend()),
        const SizedBox(height: 10),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: SizedBox(width: double.infinity, child: OutlinedButton.icon(onPressed: widget.onOpen, icon: const Icon(Icons.calendar_month_rounded), label: const Text('See full calendar & book'))),
        ),
      ]);
}

class AvailabilityLegend extends StatelessWidget {
  const AvailabilityLegend({super.key});
  @override
  Widget build(BuildContext context) => const Wrap(spacing: 14, runSpacing: 6, children: [
        _LegendItem('available', 'Available'),
        _LegendItem('limited', 'Limited'),
        _LegendItem('booked', 'Booked'),
        _LegendItem('unavailable', 'Unavailable'),
      ]);
}

class _LegendItem extends StatelessWidget {
  final String status;
  final String label;
  const _LegendItem(this.status, this.label);
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        AvailabilityDot(status),
        const SizedBox(width: 5),
        Text(label, style: const TextStyle(fontSize: 12.5, color: Brand.inkSoft, fontWeight: FontWeight.w600)),
      ]);
}

class _Reviews extends StatelessWidget {
  final VenueDetail v;
  const _Reviews({required this.v});
  @override
  Widget build(BuildContext context) {
    final s = v.reviewsSummary;
    final count = (s['count'] ?? 0) as int;
    if (count == 0) {
      return const Padding(padding: EdgeInsets.symmetric(horizontal: 20), child: Text('No reviews yet — be the first after your event.', style: TextStyle(color: Brand.inkSoft)));
    }
    final dist = Map<String, dynamic>.from(s['distribution'] ?? {});
    return Column(children: [
      Panel(
        child: Row(children: [
          Column(children: [
            Text('${s['overall']}', style: const TextStyle(fontSize: 38, fontWeight: FontWeight.w900)),
            Row(children: List.generate(5, (i) => Icon(i < (s['overall'] as num).round() ? Icons.star_rounded : Icons.star_outline_rounded, color: Brand.marigold, size: 16))),
            const SizedBox(height: 2),
            Text('$count reviews', style: const TextStyle(color: Brand.inkSoft, fontSize: 12.5)),
          ]),
          const SizedBox(width: 18),
          Expanded(
            child: Column(children: [
              for (final k in ['venue', 'food', 'service', 'cleanliness', 'value'])
                if (s[k] != null)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 2.5),
                    child: Row(children: [
                      SizedBox(width: 84, child: Text(titleCase(k), style: const TextStyle(fontSize: 12.5, color: Brand.inkSoft))),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: LinearProgressIndicator(value: (s[k] as num) / 5, minHeight: 6, backgroundColor: Brand.line, color: Brand.teal),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text('${s[k]}', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
                    ]),
                  ),
            ]),
          ),
        ]),
      ),
      const SizedBox(height: 4),
      Padding(
        padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
        child: Row(children: [
          for (final st in ['5', '4', '3', '2', '1'])
            Expanded(child: Text('$st★ ${dist[st] ?? 0}', textAlign: TextAlign.center, style: const TextStyle(fontSize: 12, color: Brand.muted, fontWeight: FontWeight.w600))),
        ]),
      ),
      for (final r in v.recentReviews)
        Padding(padding: const EdgeInsets.only(bottom: 10), child: Panel(child: ReviewTile(r))),
    ]);
  }
}

class ReviewTile extends StatelessWidget {
  final Review r;
  const ReviewTile(this.r, {super.key});
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          CircleAvatar(radius: 16, backgroundColor: Brand.tealSoft, child: Text(r.customerName.isEmpty ? '?' : r.customerName[0], style: const TextStyle(color: Brand.teal, fontWeight: FontWeight.w800))),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(r.customerName, style: const TextStyle(fontWeight: FontWeight.w700)),
              Text('${r.eventType != null ? '${eventLabel(r.eventType)} · ' : ''}${relativeTime(r.createdAt)} · Verified booking', style: const TextStyle(color: Brand.muted, fontSize: 12)),
            ]),
          ),
          RatingBadge(rating: r.overall.toDouble(), count: 1, compact: true),
        ]),
        if (r.body != null && r.body!.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text(r.body!, style: const TextStyle(height: 1.4)),
        ],
        if (r.businessReply != null) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: Brand.cream, borderRadius: BorderRadius.circular(10)),
            child: Text('Venue replied: ${r.businessReply}', style: const TextStyle(fontSize: 13, color: Brand.inkSoft)),
          ),
        ],
      ]);
}

class _Location extends StatelessWidget {
  final VenueDetail v;
  const _Location({required this.v});
  @override
  Widget build(BuildContext context) {
    final c = v.card;
    return Panel(
      padding: EdgeInsets.zero,
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        if (c.lat != null)
          SizedBox(
            height: 170,
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(top: Radius.circular(18)),
              child: FlutterMap(
                options: MapOptions(initialCenter: LatLng(c.lat!, c.lng!), initialZoom: 14.5, interactionOptions: const InteractionOptions(flags: InteractiveFlag.none)),
                children: [
                  TileLayer(urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', userAgentPackageName: 'in.pandal.pandal'),
                  MarkerLayer(markers: [Marker(point: LatLng(c.lat!, c.lng!), width: 40, height: 40, child: const Icon(Icons.location_on_rounded, color: Brand.marigold, size: 40))]),
                ],
              ),
            ),
          ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(v.address ?? c.place, style: const TextStyle(fontWeight: FontWeight.w600, height: 1.4)),
            if (c.locationVerified)
              const Padding(
                padding: EdgeInsets.only(top: 4),
                child: Text('Pin placed at the venue entrance and verified by Pandal.', style: TextStyle(color: Brand.teal, fontSize: 12.5, fontWeight: FontWeight.w600)),
              ),
            const SizedBox(height: 10),
            OutlinedButton.icon(onPressed: () => openDirections(c.lat, c.lng), icon: const Icon(Icons.directions_rounded), label: const Text('Get Directions')),
          ]),
        ),
      ]),
    );
  }
}

class _Policies extends StatelessWidget {
  final VenueDetail v;
  const _Policies({required this.v});
  @override
  Widget build(BuildContext context) => Panel(
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Cancellation & refunds', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          for (final r in v.cancellationPolicy) KeyValueRow(r.label, r.refundPct == 0 ? 'No refund' : '${r.refundPct}% refund'),
          const SizedBox(height: 4),
          const Text('Refund is a share of the advance you paid, based on how many days before the event you cancel.', style: TextStyle(color: Brand.muted, fontSize: 12.5)),
          if (v.policies.isNotEmpty) ...[
            const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Divider()),
            const Text('House rules', style: TextStyle(fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            for (final p in v.policies)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('•  ', style: TextStyle(color: Brand.marigold, fontWeight: FontWeight.w900)),
                  Expanded(child: Text(p)),
                ]),
              ),
          ],
        ]),
      );
}
