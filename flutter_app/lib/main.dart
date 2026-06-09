import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

const _remoteManifestUrl = String.fromEnvironment(
  'LOTTOBANG_MANIFEST_URL',
  defaultValue: '',
);

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const LottobangMobileApp());
}

class LottobangMobileApp extends StatelessWidget {
  const LottobangMobileApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: '추첨 패턴 연구실',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF9A5A4A),
          surface: const Color(0xFFF6F2EE),
        ),
        scaffoldBackgroundColor: const Color(0xFFF3EEE8),
        useMaterial3: true,
      ),
      home: const OfflineDashboardPage(),
    );
  }
}

class OfflineDashboardPage extends StatefulWidget {
  const OfflineDashboardPage({super.key});

  @override
  State<OfflineDashboardPage> createState() => _OfflineDashboardPageState();
}

class _OfflineDashboardPageState extends State<OfflineDashboardPage> {
  final MobileDataRepository _repository = MobileDataRepository();
  AppBundleSnapshot? _snapshot;
  bool _isLoading = true;
  bool _isUpdating = false;
  String? _statusMessage;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    _loadSnapshot();
  }

  Future<void> _loadSnapshot() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final snapshot = await _repository.loadCurrentBundle();
      setState(() {
        _snapshot = snapshot;
        _statusMessage = snapshot.sourceLabel == 'downloaded'
            ? '저장된 최신 데이터 번들을 사용 중입니다.'
            : '앱에 내장된 기본 데이터 번들을 사용 중입니다.';
      });
    } catch (error) {
      setState(() {
        _errorMessage = '$error';
      });
    } finally {
      setState(() {
        _isLoading = false;
      });
    }
  }

  Future<void> _checkForUpdates() async {
    if (_remoteManifestUrl.isEmpty) {
      setState(() {
        _statusMessage = '원격 manifest 주소가 설정되지 않아 오프라인 데이터만 사용합니다.';
      });
      return;
    }

    setState(() {
      _isUpdating = true;
      _errorMessage = null;
      _statusMessage = '업데이트를 확인하는 중입니다.';
    });

    try {
      final result = await _repository.checkForUpdates(
        remoteManifestUrl: _remoteManifestUrl,
        currentManifest: _snapshot?.manifest,
      );
      final snapshot = await _repository.loadCurrentBundle();
      setState(() {
        _snapshot = snapshot;
        _statusMessage = result.message;
      });
    } catch (error) {
      setState(() {
        _errorMessage = '$error';
      });
    } finally {
      setState(() {
        _isUpdating = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _snapshot;

    return Scaffold(
      appBar: AppBar(
        title: const Text('추첨 패턴 연구실'),
        actions: [
          IconButton(
            tooltip: '새로고침',
            onPressed: _isLoading ? null : _loadSnapshot,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: SafeArea(
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _errorMessage != null
                ? _ErrorPane(
                    message: _errorMessage!,
                    onRetry: _loadSnapshot,
                  )
                : snapshot == null
                    ? _ErrorPane(
                        message: '오프라인 데이터를 불러오지 못했습니다.',
                        onRetry: _loadSnapshot,
                      )
                    : RefreshIndicator(
                        onRefresh: _loadSnapshot,
                        child: ListView(
                          padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
                          children: [
                            _StatusCard(
                              manifest: snapshot.manifest,
                              sourceLabel: snapshot.sourceLabel,
                              statusMessage: _statusMessage,
                              remoteManifestUrl: _remoteManifestUrl,
                              isUpdating: _isUpdating,
                              onCheckUpdates: _checkForUpdates,
                            ),
                            const SizedBox(height: 16),
                            Wrap(
                              spacing: 12,
                              runSpacing: 12,
                              children: [
                                _MetricCard(
                                  label: '최신 회차',
                                  value: '${snapshot.bundle.latestDraw.roundNo}회',
                                ),
                                _MetricCard(
                                  label: '당첨 데이터',
                                  value: '${snapshot.bundle.drawsCount}개',
                                ),
                                _MetricCard(
                                  label: '가맹점 회차',
                                  value: '${snapshot.bundle.storeRoundsCount}개',
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            _LatestDrawCard(draw: snapshot.bundle.latestDraw),
                            const SizedBox(height: 16),
                            _RoundsPreviewCard(bundle: snapshot.bundle),
                          ],
                        ),
                      ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.manifest,
    required this.sourceLabel,
    required this.statusMessage,
    required this.remoteManifestUrl,
    required this.isUpdating,
    required this.onCheckUpdates,
  });

  final BundleManifest manifest;
  final String sourceLabel;
  final String? statusMessage;
  final String remoteManifestUrl;
  final bool isUpdating;
  final Future<void> Function() onCheckUpdates;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '오프라인 데이터 상태',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text('버전 ${manifest.version}'),
            Text('최신 회차 ${manifest.latestDrawRound}회'),
            Text('데이터 원본 ${sourceLabel == 'downloaded' ? '다운로드본' : '앱 내장본'}'),
            if (statusMessage != null) ...[
              const SizedBox(height: 10),
              Text(
                statusMessage!,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: isUpdating ? null : onCheckUpdates,
              icon: const Icon(Icons.cloud_download_rounded),
              label: Text(
                remoteManifestUrl.isEmpty ? '업데이트 주소 미설정' : '데이터 업데이트 확인',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 160,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 8),
              Text(
                value,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LatestDrawCard extends StatelessWidget {
  const _LatestDrawCard({required this.draw});

  final LatestDraw draw;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('최신 추첨 결과', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            Text('${draw.roundNo}회 · ${draw.drawDate}'),
            const SizedBox(height: 12),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: [
                for (final number in draw.numbers) _BallChip(label: '$number'),
                _BallChip(label: '보너스 ${draw.bonus ?? "-"}', accent: true),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _RoundsPreviewCard extends StatelessWidget {
  const _RoundsPreviewCard({required this.bundle});

  final MobileDataBundle bundle;

  @override
  Widget build(BuildContext context) {
    final recentRounds = bundle.storeArchive.reversed.take(5).toList().reversed.toList();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('최근 가맹점 회차', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            for (final round in recentRounds)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${round.roundNo}회 · ${round.drawDate}'),
                    const SizedBox(height: 4),
                    Text(
                      round.stores.take(3).map((store) => store.name).join(', '),
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _BallChip extends StatelessWidget {
  const _BallChip({
    required this.label,
    this.accent = false,
  });

  final String label;
  final bool accent;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Chip(
      label: Text(label),
      backgroundColor: accent ? scheme.primaryContainer : scheme.surfaceContainerHighest,
      side: BorderSide.none,
    );
  }
}

class _ErrorPane extends StatelessWidget {
  const _ErrorPane({
    required this.message,
    required this.onRetry,
  });

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: onRetry,
              child: const Text('다시 시도'),
            ),
          ],
        ),
      ),
    );
  }
}

class MobileDataRepository {
  static const _assetManifestPath = 'assets/data/manifest.json';
  static const _assetBundlePath = 'assets/data/data_bundle.json';

  Future<AppBundleSnapshot> loadCurrentBundle() async {
    final assetManifest = BundleManifest.fromJson(
      jsonDecode(await rootBundle.loadString(_assetManifestPath)) as Map<String, dynamic>,
    );
    final assetBundle = MobileDataBundle.fromJson(
      jsonDecode(await rootBundle.loadString(_assetBundlePath)) as Map<String, dynamic>,
    );

    final supportDir = await getApplicationSupportDirectory();
    final localManifestFile = File('${supportDir.path}/manifest.json');
    final localBundleFile = File('${supportDir.path}/data_bundle.json');

    if (await localManifestFile.exists() && await localBundleFile.exists()) {
      final localManifest = BundleManifest.fromJson(
        jsonDecode(await localManifestFile.readAsString()) as Map<String, dynamic>,
      );
      final localBundle = MobileDataBundle.fromJson(
        jsonDecode(await localBundleFile.readAsString()) as Map<String, dynamic>,
      );
      if (localManifest.latestDrawRound >= assetManifest.latestDrawRound) {
        return AppBundleSnapshot(
          manifest: localManifest,
          bundle: localBundle,
          sourceLabel: 'downloaded',
        );
      }
    }

    return AppBundleSnapshot(
      manifest: assetManifest,
      bundle: assetBundle,
      sourceLabel: 'bundled',
    );
  }

  Future<UpdateResult> checkForUpdates({
    required String remoteManifestUrl,
    BundleManifest? currentManifest,
  }) async {
    final manifestUri = Uri.parse(remoteManifestUrl);
    final manifestResponse = await http.get(manifestUri);
    if (manifestResponse.statusCode != 200) {
      throw Exception('manifest 조회 실패: ${manifestResponse.statusCode}');
    }

    final remoteManifest = BundleManifest.fromJson(
      jsonDecode(manifestResponse.body) as Map<String, dynamic>,
    );
    if (currentManifest != null &&
        remoteManifest.latestDrawRound <= currentManifest.latestDrawRound) {
      return const UpdateResult(updated: false, message: '이미 최신 데이터입니다.');
    }

    final bundleUri = manifestUri.resolve(remoteManifest.bundleFile);
    final bundleResponse = await http.get(bundleUri);
    if (bundleResponse.statusCode != 200) {
      throw Exception('데이터 번들 다운로드 실패: ${bundleResponse.statusCode}');
    }

    final bundleBytes = bundleResponse.bodyBytes;
    final bundleHash = sha256.convert(bundleBytes).toString();
    if (bundleHash != remoteManifest.bundleSha256) {
      throw Exception('다운로드한 데이터 번들의 해시가 manifest 와 일치하지 않습니다.');
    }

    final supportDir = await getApplicationSupportDirectory();
    final manifestFile = File('${supportDir.path}/manifest.json');
    final bundleFile = File('${supportDir.path}/data_bundle.json');
    await manifestFile.writeAsString(
      const JsonEncoder.withIndent('  ').convert(remoteManifest.toJson()),
    );
    await bundleFile.writeAsBytes(bundleBytes, flush: true);
    return UpdateResult(
      updated: true,
      message: '${remoteManifest.latestDrawRound}회 기준 새 데이터를 저장했습니다.',
    );
  }
}

class AppBundleSnapshot {
  const AppBundleSnapshot({
    required this.manifest,
    required this.bundle,
    required this.sourceLabel,
  });

  final BundleManifest manifest;
  final MobileDataBundle bundle;
  final String sourceLabel;
}

class UpdateResult {
  const UpdateResult({
    required this.updated,
    required this.message,
  });

  final bool updated;
  final String message;
}

class BundleManifest {
  const BundleManifest({
    required this.generatedAtUtc,
    required this.version,
    required this.latestDrawRound,
    required this.bundleFile,
    required this.bundleSha256,
    required this.bundleBytes,
  });

  factory BundleManifest.fromJson(Map<String, dynamic> json) {
    final bundle = json['bundle'] as Map<String, dynamic>;
    return BundleManifest(
      generatedAtUtc: json['generated_at_utc'] as String,
      version: json['version'] as String,
      latestDrawRound: json['latest_draw_round'] as int,
      bundleFile: bundle['file'] as String,
      bundleSha256: bundle['sha256'] as String,
      bundleBytes: bundle['bytes'] as int,
    );
  }

  final String generatedAtUtc;
  final String version;
  final int latestDrawRound;
  final String bundleFile;
  final String bundleSha256;
  final int bundleBytes;

  Map<String, dynamic> toJson() {
    return {
      'generated_at_utc': generatedAtUtc,
      'version': version,
      'latest_draw_round': latestDrawRound,
      'bundle': {
        'file': bundleFile,
        'sha256': bundleSha256,
        'bytes': bundleBytes,
      },
    };
  }
}

class MobileDataBundle {
  const MobileDataBundle({
    required this.latestDraw,
    required this.drawsCount,
    required this.storeRoundsCount,
    required this.storeArchive,
  });

  factory MobileDataBundle.fromJson(Map<String, dynamic> json) {
    final draws = (json['draws'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    final storeArchive = (json['store_archive'] as List<dynamic>)
        .cast<Map<String, dynamic>>()
        .map(StoreRound.fromJson)
        .toList();
    return MobileDataBundle(
      latestDraw: LatestDraw.fromJson(json['latest_draw'] as Map<String, dynamic>),
      drawsCount: draws.length,
      storeRoundsCount: storeArchive.length,
      storeArchive: storeArchive,
    );
  }

  final LatestDraw latestDraw;
  final int drawsCount;
  final int storeRoundsCount;
  final List<StoreRound> storeArchive;
}

class LatestDraw {
  const LatestDraw({
    required this.roundNo,
    required this.drawDate,
    required this.numbers,
    required this.bonus,
  });

  factory LatestDraw.fromJson(Map<String, dynamic> json) {
    return LatestDraw(
      roundNo: json['round_no'] as int,
      drawDate: json['draw_date'] as String,
      numbers: (json['numbers'] as List<dynamic>).cast<int>(),
      bonus: json['bonus'] as int?,
    );
  }

  final int roundNo;
  final String drawDate;
  final List<int> numbers;
  final int? bonus;
}

class StoreRound {
  const StoreRound({
    required this.roundNo,
    required this.drawDate,
    required this.stores,
  });

  factory StoreRound.fromJson(Map<String, dynamic> json) {
    return StoreRound(
      roundNo: json['round_no'] as int,
      drawDate: json['draw_date'] as String,
      stores: (json['stores'] as List<dynamic>)
          .cast<Map<String, dynamic>>()
          .map(StoreInfo.fromJson)
          .toList(),
    );
  }

  final int roundNo;
  final String drawDate;
  final List<StoreInfo> stores;
}

class StoreInfo {
  const StoreInfo({
    required this.name,
    required this.address,
  });

  factory StoreInfo.fromJson(Map<String, dynamic> json) {
    return StoreInfo(
      name: json['name'] as String,
      address: json['address'] as String,
    );
  }

  final String name;
  final String address;
}
