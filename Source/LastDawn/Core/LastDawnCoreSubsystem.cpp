#include "Core/LastDawnCoreSubsystem.h"
#include "LastDawn.h"

void ULastDawnCoreSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	UE_LOG(LogLastDawn, Log, TEXT("LAST DAWN core subsystem initialized."));
}

void ULastDawnCoreSubsystem::Deinitialize()
{
	UE_LOG(LogLastDawn, Log, TEXT("LAST DAWN core subsystem deinitialized."));

	Super::Deinitialize();
}
