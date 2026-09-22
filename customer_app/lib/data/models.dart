// Typed views over the API's JSON (see docs/API.md).

List<T> _list<T>(dynamic v, T Function(Map<String, dynamic>) f) =>
    v is List ? v.whereType<Map>().map((e) => f(Map<String, dynamic>.from(e))).toList() : <T>[];
List<String> _strings(dynamic v) => v is List ? v.map((e) => e.toString()).toList() : <String>[];
int? _int(dynamic v) => v is num ? v.toInt() : (v is String ? int.tryParse(v) : null);
double? _dbl(dynamic v) => v is num ? v.toDouble() : (v is String ? double.tryParse(v) : null);

class PlaceLocation {
  final double lat;
  final double lng;
  final String label;
  final String? area;
  final String? city;
  final String? state;
  final String? pincode;
  final String confidence; // precise | area | city | low | manual
  final String source; // gps | manual
  final double? accuracyM;
  final int radiusKm;

  const PlaceLocation({
    required this.lat,
    required this.lng,
    required this.label,
    this.area,
    this.city,
    this.state,
    this.pincode,
    this.confidence = 'manual',
    this.source = 'manual',
    this.accuracyM,
    this.radiusKm = 10,
  });

  String get shortLabel => area != null && city != null ? '$area, $city' : label;

  factory PlaceLocation.fromJson(Map<String, dynamic> j) => PlaceLocation(
        lat: _dbl(j['lat'])!,
        lng: _dbl(j['lng'])!,
        label: j['label'] ?? j['city'] ?? 'Selected location',
        area: j['area'],
        city: j['city'],
        state: j['state'],
        pincode: j['pincode'],
        confidence: j['confidence'] ?? 'manual',
        source: j['source'] ?? 'manual',
        accuracyM: _dbl(j['accuracy_m']),
        radiusKm: _int(j['radius_km']) ?? _int(j['suggested_radius_km']) ?? 10,
      );

  Map<String, dynamic> toJson() => {
        'lat': lat,
        'lng': lng,
        'label': label,
        'area': area,
        'city': city,
        'state': state,
        'pincode': pincode,
        'confidence': confidence,
        'source': source,
        'accuracy_m': accuracyM,
        'radius_km': radiusKm,
      };
}

class Availability {
  final String date;
  final String status;
  final int openSlots;
  Availability(this.date, this.status, this.openSlots);
  static Availability? fromJson(dynamic j) =>
      j is Map ? Availability(j['date'], j['status'], _int(j['open_slots']) ?? 0) : null;
}

class VenueCard {
  final String id;
  final String name;
  final String venueType;
  final String venueTypeLabel;
  final String? area;
  final String? city;
  final double? lat;
  final double? lng;
  final double? distanceKm;
  final double rating;
  final int ratingCount;
  final int? startingPrice;
  final int? capacityMin;
  final int? capacityMax;
  final int coverHue;
  final String? coverImage;
  final List<String> eventTypes;
  final List<String> facilities;
  final bool locationVerified;
  final String bookingMode;
  final Availability? availability;
  final List<String> matchReasons;

  VenueCard.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'],
        venueType = j['venue_type'] ?? '',
        venueTypeLabel = j['venue_type_label'] ?? '',
        area = j['area'],
        city = j['city'],
        lat = _dbl(j['lat']),
        lng = _dbl(j['lng']),
        distanceKm = _dbl(j['distance_km']),
        rating = _dbl(j['rating_avg']) ?? 0,
        ratingCount = _int(j['rating_count']) ?? 0,
        startingPrice = _int(j['starting_price']),
        capacityMin = _int(j['capacity_min']),
        capacityMax = _int(j['capacity_max']),
        coverHue = _int(j['cover_hue']) ?? 30,
        coverImage = j['cover_image'],
        eventTypes = _strings(j['event_types']),
        facilities = _strings(j['facilities']),
        locationVerified = j['location_verified'] == true,
        bookingMode = j['booking_mode'] ?? 'instant',
        availability = Availability.fromJson(j['availability']),
        matchReasons = _strings(j['match_reasons']);

  String get place => [area, city].whereType<String>().join(', ');
}

class Space {
  final String id;
  final String name;
  final String kind;
  final String description;
  final int seated;
  final int floating;
  final int minGuests;
  final int weekendSurchargePct;
  final Map<String, int> prices;
  final List<String> images;

  Space.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'],
        kind = j['kind'] ?? 'indoor',
        description = j['description'] ?? '',
        seated = _int(j['capacity_seated']) ?? 0,
        floating = _int(j['capacity_floating']) ?? 0,
        minGuests = _int(j['min_guests']) ?? 0,
        weekendSurchargePct = _int(j['weekend_surcharge_pct']) ?? 0,
        prices = (j['prices'] as Map? ?? {}).map((k, v) => MapEntry(k.toString(), _int(v) ?? 0)),
        images = _strings(j['images']);
}

class Inclusion {
  final String code;
  final String label;
  Inclusion.fromJson(Map<String, dynamic> j)
      : code = j['code'] ?? 'other',
        label = j['label'] ?? '';
}

class VenuePackage {
  final String id;
  final String name;
  final String tier;
  final String pricingMode; // included | flat | per_plate
  final int price;
  final int minGuests;
  final List<Inclusion> inclusions;
  final String description;

  VenuePackage.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        name = j['name'],
        tier = j['tier'] ?? 'custom',
        pricingMode = j['pricing_mode'] ?? 'flat',
        price = _int(j['price']) ?? 0,
        minGuests = _int(j['min_guests']) ?? 0,
        inclusions = _list(j['inclusions'], Inclusion.fromJson),
        description = j['description'] ?? '';

  bool includes(String category) => inclusions.any((i) => i.code == category);
}

class AddOnService {
  final String id;
  final String category;
  final String name;
  final String description;
  final String pricingMode; // flat | per_guest
  final int price;
  AddOnService.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        category = j['category'] ?? 'other',
        name = j['name'],
        description = j['description'] ?? '',
        pricingMode = j['pricing_mode'] ?? 'flat',
        price = _int(j['price']) ?? 0;
}

class PolicyRule {
  final int minDays;
  final int refundPct;
  final String label;
  PolicyRule.fromJson(Map<String, dynamic> j)
      : minDays = _int(j['min_days']) ?? 0,
        refundPct = _int(j['refund_pct']) ?? 0,
        label = j['label'] ?? '';
}

class Review {
  final String id;
  final String customerName;
  final int overall;
  final String? body;
  final String? businessReply;
  final String? eventType;
  final String createdAt;
  final Map<String, int?> sub;
  Review.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        customerName = j['customer_name'] ?? 'Guest',
        overall = _int(j['overall']) ?? 0,
        body = j['body'],
        businessReply = j['business_reply'],
        eventType = j['event_type'],
        createdAt = j['created_at'] ?? '',
        sub = {
          'Venue': _int(j['venue']),
          'Food': _int(j['food']),
          'Service': _int(j['service']),
          'Cleanliness': _int(j['cleanliness']),
          'Value': _int(j['value']),
        };
}

class GalleryItem {
  final String url;
  final String category;
  final String mediaType;
  final String? caption;
  GalleryItem.fromJson(Map<String, dynamic> j)
      : url = j['url'],
        category = j['category'] ?? '',
        mediaType = j['media_type'] ?? 'photo',
        caption = j['caption'];
}

class VenueDetail {
  final VenueCard card;
  final Map<String, dynamic> raw;
  final String description;
  final String? address;
  final String? businessName;
  bool saved;
  final int advancePct;
  final List<({String code, String label})> facilityLabels;
  final Map<String, int?> capacity;
  final String? startingPriceExplained;
  final int? perPlateFrom;
  final bool weekendSurcharge;
  final List<Space> spaces;
  final List<GalleryItem> gallery;
  final List<VenuePackage> packages;
  final List<AddOnService> services;
  final List<String> policies;
  final List<PolicyRule> cancellationPolicy;
  final Map<String, dynamic> reviewsSummary;
  final List<Review> recentReviews;

  VenueDetail.fromJson(Map<String, dynamic> j)
      : raw = j,
        card = VenueCard.fromJson(j),
        description = j['description'] ?? '',
        address = j['address'],
        businessName = j['business_name'],
        saved = j['saved'] == true,
        advancePct = _int(j['advance_pct']) ?? 20,
        facilityLabels = (j['facility_labels'] as List? ?? [])
            .map((e) => (code: e['code'].toString(), label: e['label'].toString()))
            .toList(),
        capacity = (j['capacity'] as Map? ?? {}).map((k, v) => MapEntry(k.toString(), _int(v))),
        startingPriceExplained = (j['pricing'] as Map?)?['starting_price_explained'],
        perPlateFrom = _int((j['pricing'] as Map?)?['per_plate_from']),
        weekendSurcharge = (j['pricing'] as Map?)?['weekend_surcharge'] == true,
        spaces = _list(j['spaces'], Space.fromJson),
        gallery = _list(j['gallery'], GalleryItem.fromJson),
        packages = _list(j['packages'], VenuePackage.fromJson),
        services = _list(j['services'], AddOnService.fromJson),
        policies = _strings(j['policies']),
        cancellationPolicy = _list(j['cancellation_policy'], PolicyRule.fromJson),
        reviewsSummary = Map<String, dynamic>.from(j['reviews_summary'] ?? {}),
        recentReviews = _list(j['recent_reviews'], Review.fromJson);

  String get id => card.id;
  String get name => card.name;
}

class QuoteLine {
  final String kind;
  final String label;
  final String? detail;
  final int amount;
  QuoteLine.fromJson(Map<String, dynamic> j)
      : kind = j['kind'],
        label = j['label'],
        detail = j['detail'],
        amount = _int(j['amount']) ?? 0;
}

class Quote {
  final List<QuoteLine> lines;
  final int subtotal;
  final int discount;
  final int tax;
  final int taxRateBps;
  final int total;
  final int advancePct;
  final int advance;
  final int balance;
  final List<PolicyRule> policy;
  final String? couponCode;

  Quote.fromJson(Map<String, dynamic> j)
      : lines = _list(j['lines'], QuoteLine.fromJson),
        subtotal = _int(j['subtotal']) ?? 0,
        discount = _int(j['discount']) ?? 0,
        tax = _int(j['tax']) ?? 0,
        taxRateBps = _int(j['tax_rate_bps']) ?? 1800,
        total = _int(j['total']) ?? 0,
        advancePct = _int(j['advance_pct']) ?? 20,
        advance = _int(j['advance_amount']) ?? 0,
        balance = _int(j['balance_amount']) ?? 0,
        policy = _list(j['cancellation_policy'], PolicyRule.fromJson),
        couponCode = (j['coupon'] as Map?)?['code'];
}

class Booking {
  final Map<String, dynamic> raw;
  Booking(this.raw);

  String get id => raw['id'];
  String get code => raw['code'];
  String get status => raw['status'];
  String get statusLabel => raw['status_label'] ?? status;
  String get source => raw['source'] ?? 'online';
  String get eventType => raw['event_type'] ?? 'other';
  String get eventDate => raw['event_date'];
  String get slot => raw['slot'];
  String get slotLabel => raw['slot_label'] ?? slot;
  String get slotTime => raw['slot_time'] ?? '';
  int get guests => _int(raw['guests']) ?? 0;
  Map<String, dynamic> get venue => Map<String, dynamic>.from(raw['venue'] ?? {});
  String get venueName => venue['name'] ?? '';
  int get venueHue => _int(venue['cover_hue']) ?? 30;
  double? get venueLat => _dbl(venue['lat']);
  double? get venueLng => _dbl(venue['lng']);
  String get spaceName => (raw['space'] as Map?)?['name'] ?? '';
  String? get packageName => (raw['package'] as Map?)?['name'];
  int get total => _int(raw['total']) ?? 0;
  int get subtotal => _int(raw['subtotal']) ?? 0;
  int get tax => _int(raw['tax']) ?? 0;
  int get discount => _int(raw['discount']) ?? 0;
  int get advance => _int(raw['advance_amount']) ?? 0;
  int get paid => _int(raw['paid_amount']) ?? 0;
  int get refunded => _int(raw['refunded_amount']) ?? 0;
  int get balance => _int(raw['balance_amount']) ?? 0;
  String? get holdExpiresAt => raw['hold_expires_at'];
  List<QuoteLine> get items => _list(raw['items'], QuoteLine.fromJson);
  List<Map<String, dynamic>> get history => _list(raw['history'], (m) => m);
  List<Map<String, dynamic>> get payments => _list(raw['payments'], (m) => m);
  List<Map<String, dynamic>> get refunds => _list(raw['refunds'], (m) => m);
  List<PolicyRule> get policy => _list(raw['cancellation_policy'], PolicyRule.fromJson);
  Map<String, dynamic> get cancellation => Map<String, dynamic>.from(raw['cancellation'] ?? {});
  bool get canReview => raw['can_review'] == true;
  bool get canPayBalance => raw['can_pay_balance'] == true;
  Map<String, dynamic>? get review => raw['review'] == null ? null : Map<String, dynamic>.from(raw['review']);
  String? get cancelReason => raw['cancel_reason'];

  bool get awaitingPayment => const ['PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_FAILED'].contains(status);
  bool get isLive => const ['CONFIRMED', 'UPCOMING'].contains(status);
}

class AppNotification {
  final String id;
  final String type;
  final String title;
  final String body;
  final String? readAt;
  final String createdAt;
  final Map<String, dynamic> data;
  AppNotification.fromJson(Map<String, dynamic> j)
      : id = j['id'],
        type = j['type'],
        title = j['title'],
        body = j['body'],
        readAt = j['read_at'],
        createdAt = j['created_at'],
        data = Map<String, dynamic>.from(j['data'] ?? {});
}
