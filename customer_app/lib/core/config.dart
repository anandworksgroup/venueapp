import 'package:flutter/foundation.dart';

/// Backend base URL. Override with --dart-define=API_BASE=http://192.168.1.20:4000
/// for a physical phone on the same Wi-Fi as the backend.
class AppConfig {
  static const _override = String.fromEnvironment('API_BASE');

  static String get apiBase {
    if (_override.isNotEmpty) return _override;
    if (kIsWeb) {
      // Served by the backend itself, or `flutter run -d chrome` next to it.
      final host = Uri.base.host.isEmpty ? 'localhost' : Uri.base.host;
      return 'http://$host:4000';
    }
    if (defaultTargetPlatform == TargetPlatform.android) return 'http://10.0.2.2:4000';
    return 'http://localhost:4000';
  }

  static const holdWarningSeconds = 120;
}
