import 'dart:convert';
import 'dart:math';

import 'package:http/http.dart' as http;

import '../core/config.dart';

class ApiException implements Exception {
  final int status;
  final String code;
  final String message;
  final Map<String, dynamic>? details;
  ApiException(this.status, this.code, this.message, [this.details]);

  bool get isNetwork => status == 0;
  @override
  String toString() => message;
}

/// Thin JSON client for the Pandal backend (docs/API.md).
class Api {
  Api._();
  static final Api instance = Api._();

  String? token;
  final _client = http.Client();

  Uri uri(String path, [Map<String, dynamic>? query]) {
    final q = <String, String>{};
    query?.forEach((k, v) {
      if (v == null) return;
      if (v is List) {
        if (v.isNotEmpty) q[k] = v.join(',');
      } else if (v.toString().isNotEmpty) {
        q[k] = v.toString();
      }
    });
    return Uri.parse('${AppConfig.apiBase}/api/v1$path').replace(queryParameters: q.isEmpty ? null : q);
  }

  Map<String, String> _headers([Map<String, String>? extra]) => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (token != null) 'Authorization': 'Bearer $token',
        ...?extra,
      };

  Future<dynamic> get(String path, [Map<String, dynamic>? query]) =>
      _send(() => _client.get(uri(path, query), headers: _headers()));

  Future<dynamic> post(String path, [Object? body, Map<String, String>? headers]) =>
      _send(() => _client.post(uri(path), headers: _headers(headers), body: jsonEncode(body ?? {})));

  Future<dynamic> put(String path, [Object? body]) =>
      _send(() => _client.put(uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  Future<dynamic> patch(String path, [Object? body]) =>
      _send(() => _client.patch(uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  Future<dynamic> delete(String path) => _send(() => _client.delete(uri(path), headers: _headers()));

  Future<dynamic> _send(Future<http.Response> Function() fn) async {
    http.Response res;
    try {
      res = await fn().timeout(const Duration(seconds: 20));
    } catch (_) {
      throw ApiException(0, 'NETWORK', "Can't reach Pandal right now. Check your connection and try again.");
    }
    dynamic body;
    try {
      body = res.body.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return body;
    final err = body is Map ? body['error'] as Map? : null;
    throw ApiException(
      res.statusCode,
      (err?['code'] ?? 'HTTP_${res.statusCode}').toString(),
      (err?['message'] ?? 'Something went wrong (${res.statusCode})').toString(),
      err?['details'] is Map ? Map<String, dynamic>.from(err!['details']) : null,
    );
  }

  static String newIdempotencyKey() {
    final r = Random.secure();
    return List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
  }
}
