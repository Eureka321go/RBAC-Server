package com.rbac.im.push.registration;

import com.rbac.common.util.SecurityUtils;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/im/push/registrations")
public class ImPushRegistrationController {

    private final PushRegistrationService registrationService;

    public ImPushRegistrationController(PushRegistrationService registrationService) {
        this.registrationService = registrationService;
    }

    @PutMapping("/{deviceId}")
    public ResponseEntity<Void> put(@Size(max = 64) @PathVariable String deviceId,
                                    @Valid @RequestBody PushRegistrationRequest request) {
        registrationService.upsert(SecurityUtils.getUserId(), deviceId, request);
        return ResponseEntity.noContent().build();
    }

    @DeleteMapping("/{deviceId}")
    public ResponseEntity<Void> delete(@Size(max = 64) @PathVariable String deviceId) {
        registrationService.disable(SecurityUtils.getUserId(), deviceId);
        return ResponseEntity.noContent().build();
    }
}
