export default function Home() {
  return (
    <main className="page">
      <section className="hero">
        <div>
          <div className="signal">Pathology Intelligence</div>
          <h1>WSI 병리 데이터에서 의미 있는 신호를 찾아냅니다.</h1>
          <p>
            슬라이드 입력, 자동 품질 검증, 조직 구조 탐지, 리포트 출력까지.
            병리 데이터 분석 파이프라인을 한 화면에서 관리하세요.
          </p>
          <div className="cta-row">
            <a className="cta primary" href="/upload">
              새 슬라이드 업로드
            </a>
            <a className="cta ghost" href="/jobs">
              분석 작업 보기
            </a>
            <a className="cta ghost" href="/login">
              연구실 로그인
            </a>
          </div>
        </div>
        <div className="hero-card">
          <div className="signal">Run Status</div>
          <h2>Clinical Preview</h2>
          <p>
            조직 타일의 밀도, 핵 분포, 염색 균질도를 실시간으로 요약해
            진단 준비 상태를 확인합니다.
          </p>
          <div className="metrics">
            <div className="metric">
              <strong>94%</strong>
              <span>Stain Consistency</span>
            </div>
            <div className="metric">
              <strong>3.1M</strong>
              <span>Tiles Processed</span>
            </div>
            <div className="metric">
              <strong>12</strong>
              <span>Outlier Regions</span>
            </div>
          </div>
        </div>
      </section>

      <section className="panel-grid">
        <div className="panel">
          <h3>Specimen Intake</h3>
          <p>WSI 파일을 업로드하면 자동으로 샘플 메타데이터가 연결됩니다.</p>
        </div>
        <div className="panel">
          <h3>QC &amp; Tiling</h3>
          <p>배경 제거와 타일링, 아티팩트 감지를 병렬로 수행합니다.</p>
        </div>
        <div className="panel">
          <h3>Feature Extraction</h3>
          <p>핵 밀도, 구조 패턴, 염색 강도를 벡터로 요약합니다.</p>
        </div>
        <div className="panel">
          <h3>Review &amp; Share</h3>
          <p>리포트를 생성하고 팀과 분석 결과를 공유할 수 있습니다.</p>
        </div>
      </section>

      <section className="pipeline">
        <div className="step">
          <div className="signal">Step 01</div>
          <h3>Slide Ingestion</h3>
          <p>2GB까지 WSI를 받아 스토리지에 안전하게 저장합니다.</p>
        </div>
        <div className="step">
          <div className="signal">Step 02</div>
          <h3>Quality Gates</h3>
          <p>초점 품질과 염색 변이를 평가하고 불량 영역을 마스킹합니다.</p>
        </div>
        <div className="step">
          <div className="signal">Step 03</div>
          <h3>Model Inference</h3>
          <p>조직 패턴 분류와 이상 영역 탐지 모델을 동시 실행합니다.</p>
        </div>
        <div className="step">
          <div className="signal">Step 04</div>
          <h3>Reporting</h3>
          <p>임상 리포트에 필요한 요약 지표와 시각화를 준비합니다.</p>
        </div>
      </section>
    </main>
  );
}
