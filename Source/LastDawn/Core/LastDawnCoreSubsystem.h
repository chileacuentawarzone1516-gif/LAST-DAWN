#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "LastDawnCoreSubsystem.generated.h"

/**
 *  First project-owned global service of LAST DAWN
 */
UCLASS()
class LASTDAWN_API ULastDawnCoreSubsystem final : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
};
