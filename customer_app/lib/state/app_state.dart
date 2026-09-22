import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../data/api.dart';
import '../data/models.dart';

class Category {
  final String code;
  final String name;
  Category(this.code, this.name);
}

/// App-wide state: location, session, platform vocabulary, saved venues.
class AppState extends ChangeNotifier {
  SharedPreferences? _prefs;

  PlaceLocation? location;
  List<PlaceLocation> recentLocations = [];

  Map<String, dynamic>? user;
  bool get loggedIn => user != null && Api.instance.token != null;
  String? get firstName => (user?['name'] as String?)?.split(' ').first;

  List<Category> categories = [];
  List<({String code, String name})> facilities = [];
  List<({String code, String name})> venueTypes = [];
  List<({String code, String name})> sorts = [];
  String today = isoToday();
  final Set<String> savedIds = {};
  int unreadNotifications = 0;

  static String isoToday() {
    final n = DateTime.now();
    return '${n.year.toString().padLeft(4, '0')}-${n.month.toString().padLeft(2, '0')}-${n.day.toString().padLeft(2, '0')}';
  }

  Future<void> init() async {
    try {
      _prefs = await SharedPreferences.getInstance();
    } catch (_) {
      _prefs = null;
    }
    final p = _prefs;
    if (p != null) {
      final loc = p.getString('location');
      if (loc != null) {
        try {
          location = PlaceLocation.fromJson(jsonDecode(loc));
        } catch (_) {}
      }
      final recents = p.getStringList('recent_locations') ?? [];
      recentLocations = recents
          .map((s) {
            try {
              return PlaceLocation.fromJson(jsonDecode(s));
            } catch (_) {
              return null;
            }
          })
          .whereType<PlaceLocation>()
          .toList();
      Api.instance.token = p.getString('token');
      final u = p.getString('user');
      if (u != null && Api.instance.token != null) user = jsonDecode(u);
    }
    await loadMeta();
    if (loggedIn) {
      refreshUser();
      refreshSaved();
      refreshUnread();
    }
  }

  Future<void> loadMeta() async {
    try {
      final m = await Api.instance.get('/meta');
      categories = (m['event_categories'] as List).map((c) => Category(c['code'], c['name'])).toList();
      facilities = (m['facilities'] as List).map((c) => (code: c['code'] as String, name: c['name'] as String)).toList();
      venueTypes = (m['venue_types'] as List).map((c) => (code: c['code'] as String, name: c['name'] as String)).toList();
      sorts = (m['sorts'] as List).map((c) => (code: c['code'] as String, name: c['name'] as String)).toList();
      today = m['today'] ?? today;
      notifyListeners();
    } catch (_) {
      // Offline at launch: screens show their own retry states.
    }
  }

  String categoryName(String? code) =>
      categories.firstWhere((c) => c.code == code, orElse: () => Category(code ?? 'other', _title(code ?? 'Event'))).name;

  String facilityName(String code) =>
      facilities.firstWhere((f) => f.code == code, orElse: () => (code: code, name: _title(code))).name;

  static String _title(String s) => s.replaceAll('_', ' ').split(' ').map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1)).join(' ');

  // ── Location ──
  Future<void> setLocation(PlaceLocation loc) async {
    location = loc;
    recentLocations.removeWhere((r) => r.shortLabel == loc.shortLabel);
    recentLocations.insert(0, loc);
    if (recentLocations.length > 5) recentLocations = recentLocations.sublist(0, 5);
    try {
      await _prefs?.setString('location', jsonEncode(loc.toJson()));
      await _prefs?.setStringList('recent_locations', recentLocations.map((l) => jsonEncode(l.toJson())).toList());
    } catch (_) {}
    notifyListeners();
  }

  // ── Session ──
  Future<void> signIn(String token, Map<String, dynamic> u) async {
    Api.instance.token = token;
    user = u;
    try {
      await _prefs?.setString('token', token);
      await _prefs?.setString('user', jsonEncode(u));
    } catch (_) {}
    notifyListeners();
    refreshSaved();
    refreshUnread();
  }

  Future<void> signOut() async {
    Api.instance.token = null;
    user = null;
    savedIds.clear();
    unreadNotifications = 0;
    try {
      await _prefs?.remove('token');
      await _prefs?.remove('user');
    } catch (_) {}
    notifyListeners();
  }

  Future<void> refreshUser() async {
    try {
      final r = await Api.instance.get('/me');
      user = Map<String, dynamic>.from(r['user']);
      await _prefs?.setString('user', jsonEncode(user));
      notifyListeners();
    } on ApiException catch (e) {
      if (e.status == 401) await signOut();
    }
  }

  Future<void> updateName(String name) async {
    final r = await Api.instance.patch('/me', {'name': name});
    if (r is Map && r['user'] != null) {
      user = Map<String, dynamic>.from(r['user']);
      await _prefs?.setString('user', jsonEncode(user));
      notifyListeners();
    }
  }

  Future<void> refreshSaved() async {
    if (!loggedIn) return;
    try {
      final r = await Api.instance.get('/saved');
      savedIds
        ..clear()
        ..addAll((r['items'] as List).map((v) => v['id'] as String));
      notifyListeners();
    } catch (_) {}
  }

  Future<void> refreshUnread() async {
    if (!loggedIn) return;
    try {
      final r = await Api.instance.get('/notifications');
      unreadNotifications = r['unread'] ?? 0;
      notifyListeners();
    } catch (_) {}
  }

  /// Returns the new saved state. Caller must ensure the user is signed in.
  Future<bool> toggleSaved(String venueId) async {
    final was = savedIds.contains(venueId);
    was ? savedIds.remove(venueId) : savedIds.add(venueId);
    notifyListeners();
    try {
      if (was) {
        await Api.instance.delete('/saved/$venueId');
      } else {
        await Api.instance.put('/saved/$venueId');
      }
    } catch (e) {
      was ? savedIds.add(venueId) : savedIds.remove(venueId);
      notifyListeners();
      rethrow;
    }
    return !was;
  }
}

/// Where + What + When + How many + Budget — the search the whole app revolves around.
class SearchQuery {
  String? q;
  String? event;
  String? date;
  String? dateFrom;
  String? dateTo;
  String? dateLabel;
  String? slot;
  int? guests;
  String? guestsLabel;
  int? budgetMax;
  int? radiusKm;
  bool nearMe = true;
  List<String> venueTypes = [];
  List<String> facilities = [];
  String? sort;

  SearchQuery({this.q, this.event, this.date, this.guests, this.budgetMax, this.radiusKm});

  SearchQuery copy() => SearchQuery()
    ..q = q
    ..event = event
    ..date = date
    ..dateFrom = dateFrom
    ..dateTo = dateTo
    ..dateLabel = dateLabel
    ..slot = slot
    ..guests = guests
    ..guestsLabel = guestsLabel
    ..budgetMax = budgetMax
    ..radiusKm = radiusKm
    ..nearMe = nearMe
    ..venueTypes = [...venueTypes]
    ..facilities = [...facilities]
    ..sort = sort;

  int get activeFilterCount =>
      [event, date ?? dateFrom, guests, budgetMax, radiusKm].where((x) => x != null).length + venueTypes.length + facilities.length;

  Map<String, dynamic> toParams(PlaceLocation? loc) => {
        'q': q,
        'event': event,
        'date': date,
        'date_from': date == null ? dateFrom : null,
        'date_to': date == null ? dateTo : null,
        'slot': slot,
        'guests': guests,
        'budget_max': budgetMax,
        'radius_km': radiusKm,
        'venue_type': venueTypes,
        'facilities': facilities,
        'sort': sort,
        if (loc != null) 'lat': loc.lat,
        if (loc != null) 'lng': loc.lng,
        if (loc != null) 'location_label': loc.shortLabel,
        'limit': 50,
      };
}
