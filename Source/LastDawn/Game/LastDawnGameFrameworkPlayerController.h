#pragma once

#include "CoreMinimal.h"
#include "LastDawnPlayerController.h"
#include "LastDawnGameFrameworkPlayerController.generated.h"

/**
 *  Project-owned PlayerController layer on top of the template-derived base
 */
UCLASS()
class LASTDAWN_API ALastDawnGameFrameworkPlayerController : public ALastDawnPlayerController
{
	GENERATED_BODY()
};
