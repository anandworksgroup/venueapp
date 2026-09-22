import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';

import 'api.dart';
import 'models.dart';

enum LocationFailure { serviceOff, denied, deniedForever, timeout, unknown }

class LocationFix {
  final PlaceLocation? place;
  final LocationFailure? failure;
  final Map<String, dynamic>? geo; // raw /locations/reverse response
  const LocationFix({this.place, this.failure, this.geo});

  String get confidence => geo?['confidence'] ?? 'low';
  bool get needsConfirmation => geo?['needs_confirmation'] == true;
  List<String> get warnings => ((geo?['warnings'] as List?) ?? []).map((e) => e.toString()).toList();
}

/// GPS → permission → coordinates (+accuracy, timestamp, provider) →
/// reverse geocode on the server → label at the precision the fix supports.
class LocationService {
  static Future<LocationFix> locate({bool highAccuracy = false}) async {
    try {
      if (!kIsWeb && !await Geolocator.isLocationServiceEnabled()) {
        return const LocationFix(failure: LocationFailure.serviceOff);
      }
      var perm = await Geolocator.checkPermission();
      if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
      if (perm == LocationPermission.denied) return const LocationFix(failure: LocationFailure.denied);
      if (perm == LocationPermission.deniedForever) return const LocationFix(failure: LocationFailure.deniedForever);

      final pos = await Geolocator.getCurrentPosition(
        locationSettings: LocationSettings(
          accuracy: highAccuracy ? LocationAccuracy.best : LocationAccuracy.high,
          timeLimit: Duration(seconds: highAccuracy ? 25 : 15),
        ),
      );
      final provider = kIsWeb ? 'browser' : (pos.isMocked ? 'mock' : defaultTargetPlatform.name);
      final geo = Map<String, dynamic>.from(await Api.instance.get('/locations/reverse', {
        'lat': pos.latitude,
        'lng': pos.longitude,
        'accuracy': pos.accuracy.isFinite && pos.accuracy > 0 ? pos.accuracy.round() : null,
        'provider': provider,
        'timestamp': pos.timestamp.millisecondsSinceEpoch,
      }));
      final place = PlaceLocation(
        lat: pos.latitude,
        lng: pos.longitude,
        label: geo['label'] ?? 'Current location',
        area: geo['area'],
        city: geo['city'],
        state: geo['state'],
        pincode: geo['pincode'],
        confidence: geo['confidence'] ?? 'low',
        source: 'gps',
        accuracyM: pos.accuracy,
        radiusKm: geo['suggested_radius_km'] ?? 10,
      );
      return LocationFix(place: place, geo: geo);
    } on ApiException {
      rethrow;
    } catch (e) {
      final s = e.toString().toLowerCase();
      if (s.contains('timeout') || s.contains('time limit')) return const LocationFix(failure: LocationFailure.timeout);
      if (s.contains('denied')) return const LocationFix(failure: LocationFailure.denied);
      return const LocationFix(failure: LocationFailure.unknown);
    }
  }

  static Future<void> openSettings(LocationFailure f) async {
    if (kIsWeb) return;
    if (f == LocationFailure.serviceOff) {
      await Geolocator.openLocationSettings();
    } else {
      await Geolocator.openAppSettings();
    }
  }

  static String describe(LocationFailure f) => switch (f) {
        LocationFailure.serviceOff => 'Location services are turned off on this device.',
        LocationFailure.denied => 'Location permission was not granted.',
        LocationFailure.deniedForever => 'Location permission is blocked. You can allow it in Settings.',
        LocationFailure.timeout => "We couldn't get a GPS fix in time. Try again near a window or outdoors.",
        LocationFailure.unknown => "We couldn't read your location.",
      };
}
