import React, { useState, useCallback } from "react";
import css from "./Home.module.css";
import PendingRfqPackageList from "./components/PendingRfqPackageList";
import PackageDetail from "./components/PackageDetail";

function Home(): React.ReactElement {
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(
    null,
  );

  const handleSelectPackage = useCallback((packageId: string) => {
    setSelectedPackageId((prev) => (prev === packageId ? null : packageId));
  }, []);

  return (
    <div className={css.home}>
      <div className={css.listPanel}>
        <PendingRfqPackageList
          onSelectPackage={handleSelectPackage}
          selectedPackageId={selectedPackageId}
        />
      </div>
      <div className={css.detailPanel}>
        {selectedPackageId ? (
          <PackageDetail packageId={selectedPackageId} />
        ) : (
          <div className={css.emptyDetail}>
            Select a package from the list to view its details.
          </div>
        )}
      </div>
    </div>
  );
}

export default Home;
